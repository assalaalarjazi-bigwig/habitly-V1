import { Habit } from '../types';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { soundService } from './soundService';

export interface InAppNotification {
  id: string;
  title: string;
  body: string;
  habitName?: string;
  icon?: string;
  timestamp: number;
}

type NotificationListener = (notification: InAppNotification) => void;

export const NOTIFICATION_CHANNEL_ID = 'habit_reminders_v2';
export const NOTIFICATION_SOUND_FILE = 'habit_alert.wav';

/**
 * Deterministically convert a habit ID string to a positive 32-bit integer
 * as required by Android LocalNotification ID
 */
function hashStringToId(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 2147483000) + 1;
}

class NotificationService {
  private listeners: Set<NotificationListener> = new Set();
  private timer: number | null = null;
  private scheduledReminders: Map<string, string> = new Map(); // habitId -> HH:MM
  private isNative: boolean = false;
  private channelCreated: boolean = false;

  constructor() {
    this.isNative = Capacitor.isNativePlatform();
    this.initNativeChannel();
    this.startInAppReminderChecker();
  }

  /**
   * Ensure high-importance notification channel with audible sound is registered on Android 8+
   */
  private async initNativeChannel() {
    if (!this.isNative) return;

    try {
      // Remove obsolete channel if it existed without sound
      try {
        await LocalNotifications.deleteChannel({ id: 'habit_reminders' });
      } catch {
        // Channel delete is optional
      }

      await LocalNotifications.createChannel({
        id: NOTIFICATION_CHANNEL_ID,
        name: 'تذكيرات العادات والمنبه | Habit Reminders',
        description: 'إشعارات وتنبيهات صوتية فورية لمواعيد إنجاز العادات اليومية في موعدها',
        importance: 5, // High / Heads-up notification with sound & vibration
        visibility: 1, // Public visibility on lockscreen
        sound: NOTIFICATION_SOUND_FILE,
        vibration: true,
        lights: true,
        lightColor: '#10B981',
      });
      this.channelCreated = true;

      // Handle user tapping on native notification
      LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
        console.log('User interacted with notification:', action.notification);
      });
    } catch (e) {
      console.warn('Could not initialize native notification channel:', e);
    }
  }

  public subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Request system-level notification permissions
   */
  public async requestPermission(): Promise<{ granted: boolean; explanation?: string }> {
    if (this.isNative) {
      try {
        await this.initNativeChannel();
        const result = await LocalNotifications.requestPermissions();
        const isGranted = result.display === 'granted';
        return {
          granted: isGranted,
          explanation: isGranted ? undefined : 'notifications_denied_help',
        };
      } catch (err) {
        console.warn('Native permission request failed:', err);
        return {
          granted: false,
          explanation: 'notifications_denied_help',
        };
      }
    }

    // Web Browser fallback
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return {
        granted: false,
        explanation: 'notifications_unsupported',
      };
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        return { granted: true };
      } else {
        return {
          granted: false,
          explanation: 'notifications_denied_help',
        };
      }
    } catch {
      return {
        granted: false,
        explanation: 'notifications_denied_help',
      };
    }
  }

  public async getPermissionStatus(): Promise<'granted' | 'denied' | 'prompt' | 'default'> {
    if (this.isNative) {
      try {
        const check = await LocalNotifications.checkPermissions();
        if (check.display === 'granted') return 'granted';
        if (check.display === 'denied') return 'denied';
        return 'prompt';
      } catch {
        return 'prompt';
      }
    }

    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'denied';
    }
    return Notification.permission as 'granted' | 'denied' | 'default';
  }

  /**
   * Sync and schedule native repeating alarms for all active habits
   * Operates completely in the background via Android AlarmManager / NotificationManager
   */
  public async syncHabits(habits: Habit[]) {
    this.scheduledReminders.clear();

    const remindersToSchedule: { habit: Habit; hour: number; minute: number }[] = [];

    habits.forEach((h) => {
      if (h.reminderEnabled && h.reminderTime) {
        this.scheduledReminders.set(h.id, h.reminderTime);
        const [hourStr, minStr] = h.reminderTime.split(':');
        const hour = parseInt(hourStr, 10);
        const minute = parseInt(minStr, 10);
        if (!isNaN(hour) && !isNaN(minute)) {
          remindersToSchedule.push({ habit: h, hour, minute });
        }
      }
    });

    if (this.isNative) {
      try {
        await this.initNativeChannel();

        // 1. Cancel previous pending notifications
        const pending = await LocalNotifications.getPending();
        if (pending.notifications.length > 0) {
          await LocalNotifications.cancel({ notifications: pending.notifications });
        }

        if (remindersToSchedule.length === 0) return;

        // 2. Build repeating daily notification schemas with alert sound
        const now = new Date();
        const notificationBatch = remindersToSchedule.map(({ habit, hour, minute }) => {
          const target = new Date();
          target.setHours(hour, minute, 0, 0);

          // If the time has already passed today, start from tomorrow
          if (target.getTime() <= now.getTime()) {
            target.setDate(target.getDate() + 1);
          }

          return {
            id: hashStringToId(habit.id),
            title: `⏰ تذكير بعادة: ${habit.name}`,
            body: `حان موعد إنجاز عادتك اليومية "${habit.name}"! حافظ على سلسلتك اليومية ✨`,
            schedule: {
              at: target,
              repeats: true,
              every: 'day' as const,
              allowWhileIdle: true,
            },
            channelId: NOTIFICATION_CHANNEL_ID,
            sound: NOTIFICATION_SOUND_FILE,
            smallIcon: 'ic_stat_habit',
            iconColor: '#10B981',
            extra: {
              habitId: habit.id,
              habitName: habit.name,
            },
          };
        });

        await LocalNotifications.schedule({
          notifications: notificationBatch,
        });

        console.log(`Successfully scheduled ${notificationBatch.length} native alarms with audio alert on channel ${NOTIFICATION_CHANNEL_ID}.`);
      } catch (err) {
        console.warn('Failed to schedule native local notifications:', err);
      }
    }
  }

  public async scheduleHabitReminder(habit: Habit) {
    if (!habit.reminderEnabled || !habit.reminderTime) {
      await this.cancelHabitReminder(habit.id);
      return;
    }

    this.scheduledReminders.set(habit.id, habit.reminderTime);

    if (this.isNative) {
      try {
        await this.initNativeChannel();
        const id = hashStringToId(habit.id);

        // Cancel existing notification for this habit first
        await LocalNotifications.cancel({ notifications: [{ id }] });

        const [hStr, mStr] = habit.reminderTime.split(':');
        const hour = parseInt(hStr, 10);
        const minute = parseInt(mStr, 10);

        if (!isNaN(hour) && !isNaN(minute)) {
          const now = new Date();
          const target = new Date();
          target.setHours(hour, minute, 0, 0);
          if (target.getTime() <= now.getTime()) {
            target.setDate(target.getDate() + 1);
          }

          await LocalNotifications.schedule({
            notifications: [
              {
                id,
                title: `⏰ تذكير بعادة: ${habit.name}`,
                body: `حان موعد إنجاز عادتك اليومية "${habit.name}"! حافظ على سلسلتك اليومية ✨`,
                schedule: {
                  at: target,
                  repeats: true,
                  every: 'day',
                  allowWhileIdle: true,
                },
                channelId: NOTIFICATION_CHANNEL_ID,
                sound: NOTIFICATION_SOUND_FILE,
                smallIcon: 'ic_stat_habit',
                iconColor: '#10B981',
                extra: { habitId: habit.id },
              },
            ],
          });
        }
      } catch (err) {
        console.warn('Failed to schedule single native reminder:', err);
      }
    }
  }

  public async cancelHabitReminder(habitId: string) {
    this.scheduledReminders.delete(habitId);
    if (this.isNative) {
      try {
        const id = hashStringToId(habitId);
        await LocalNotifications.cancel({ notifications: [{ id }] });
      } catch (err) {
        console.warn('Failed to cancel native notification:', err);
      }
    }
  }

  /**
   * Broadcast an in-app and/or system notification immediately with sound
   */
  public async triggerNotification(title: string, body: string, habitName?: string, icon?: string) {
    // 0. Trigger audio chime alert immediately!
    soundService.playReminderAlert();

    const item: InAppNotification = {
      id: `notif_${Date.now()}_${Math.random()}`,
      title,
      body,
      habitName,
      icon,
      timestamp: Date.now(),
    };

    // 1. In-app listeners (active toast if app is currently visible)
    this.listeners.forEach((listener) => {
      try {
        listener(item);
      } catch (err) {
        console.warn('Notification listener error:', err);
      }
    });

    // 2. Native System Notification (triggers Android Notification Shade / Lock Screen with sound & vibration)
    if (this.isNative) {
      try {
        await this.initNativeChannel();
        await LocalNotifications.schedule({
          notifications: [
            {
              id: (Date.now() % 2147480000) + 1,
              title,
              body,
              schedule: {
                at: new Date(Date.now() + 500), // Fire almost immediately
                allowWhileIdle: true,
              },
              channelId: NOTIFICATION_CHANNEL_ID,
              sound: NOTIFICATION_SOUND_FILE,
              smallIcon: 'ic_stat_habit',
              iconColor: '#10B981',
            },
          ],
        });
      } catch (e) {
        console.warn('Native immediate notification dispatch failed:', e);
      }
      return;
    }

    // 3. Web Browser System Notification if granted
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body,
          icon: '/icon-192.png',
        });
      } catch (e) {
        console.warn('Browser notification dispatch error:', e);
      }
    }
  }

  /**
   * In-app fallback loop for when the app is actively open in foreground
   */
  private startInAppReminderChecker() {
    if (typeof window === 'undefined') return;

    let lastFiredMinute = '';

    this.timer = window.setInterval(() => {
      const now = new Date();
      const currentMinute = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      if (currentMinute === lastFiredMinute) return;
      lastFiredMinute = currentMinute;

      this.scheduledReminders.forEach((time, habitId) => {
        if (time === currentMinute) {
          // If we are NOT native, fire in-app/web notification and sound
          // (On native, the system AlarmManager fires it automatically with audio)
          if (!this.isNative) {
            this.triggerNotification(
              '⏰ تذكير بعادة | Habit Reminder',
              `حان الوقت لإنجاز عادتك اليومية! حافظ على سلسلتك! ✨`,
              habitId
            );
          }
        }
      });
    }, 15000);
  }
}

export const notificationService = new NotificationService();
