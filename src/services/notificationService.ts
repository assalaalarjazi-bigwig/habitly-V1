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

export const NOTIFICATION_CHANNEL_ID = 'habit_reminders_v3';
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
  private scheduledReminders: Map<string, { time: string; name: string }> = new Map(); // habitId -> { time: HH:MM, name }
  private isNative: boolean = false;
  private channelCreated: boolean = false;
  private lastFiredTracker: Map<string, string> = new Map(); // habitId -> YYYY-MM-DD to avoid duplicates
  private lastHabitsHash: string = '';

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
      // Clean up older channels if any
      try {
        await LocalNotifications.deleteChannel({ id: 'habit_reminders' });
        await LocalNotifications.deleteChannel({ id: 'habit_reminders_v2' });
      } catch {
        // Channel delete is optional
      }

      await LocalNotifications.createChannel({
        id: NOTIFICATION_CHANNEL_ID,
        name: 'تذكيرات العادات والمنبه | Habit Reminders',
        description: 'إشعارات وتنبيهات صوتية فورية لمواعيد إنجاز العادات اليومية في موعدها الدقيق',
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
   * Uses exact `on: { hour, minute }` schedule syntax which Android AlarmManager
   * evaluates strictly at that time without any immediate catch-up burst!
   */
  public async syncHabits(habits: Habit[]) {
    // 1. Compute stable hash of active reminders to prevent re-scheduling if unchanged
    const reminderItems = habits
      .filter((h) => h.reminderEnabled && Boolean(h.reminderTime))
      .map((h) => `${h.id}_${h.reminderTime}_${h.name}`)
      .sort();
    const currentHash = reminderItems.join('|');

    // Always update in-memory map for the foreground timer
    this.scheduledReminders.clear();
    const validReminders: { habit: Habit; hour: number; minute: number }[] = [];

    habits.forEach((h) => {
      if (h.reminderEnabled && h.reminderTime) {
        const [hourStr, minStr] = h.reminderTime.split(':');
        const hour = parseInt(hourStr, 10);
        const minute = parseInt(minStr, 10);
        if (!isNaN(hour) && !isNaN(minute)) {
          this.scheduledReminders.set(h.id, { time: h.reminderTime, name: h.name });
          validReminders.push({ habit: h, hour, minute });
        }
      }
    });

    // If native schedules haven't changed, skip re-scheduling to avoid clearing/re-creating alarms
    if (this.isNative && currentHash === this.lastHabitsHash) {
      return;
    }
    this.lastHabitsHash = currentHash;

    if (this.isNative) {
      try {
        await this.initNativeChannel();

        // Cancel previous pending notifications
        const pending = await LocalNotifications.getPending();
        if (pending.notifications.length > 0) {
          await LocalNotifications.cancel({ notifications: pending.notifications });
        }

        if (validReminders.length === 0) return;

        // Schedule using `schedule.on: { hour, minute }`
        // In Capacitor LocalNotifications on Android, `on` matches the exact cron time.
        // It NEVER executes immediately upon scheduling if the time has passed today!
        const notificationBatch = validReminders.map(({ habit, hour, minute }) => {
          return {
            id: hashStringToId(habit.id),
            title: `⏰ تذكير بعادة: ${habit.name}`,
            body: `حان موعد إنجاز عادتك اليومية "${habit.name}"! حافظ على سلسلتك اليومية ✨`,
            schedule: {
              on: {
                hour,
                minute,
              },
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

        console.log(`Successfully scheduled ${notificationBatch.length} exact alarms using 'on: {hour, minute}' syntax.`);
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

    const [hStr, mStr] = habit.reminderTime.split(':');
    const hour = parseInt(hStr, 10);
    const minute = parseInt(mStr, 10);

    if (isNaN(hour) || isNaN(minute)) return;

    this.scheduledReminders.set(habit.id, { time: habit.reminderTime, name: habit.name });
    this.lastHabitsHash = ''; // Reset hash so sync stays in sync

    if (this.isNative) {
      try {
        await this.initNativeChannel();
        const id = hashStringToId(habit.id);

        // Cancel existing notification for this habit first
        await LocalNotifications.cancel({ notifications: [{ id }] });

        await LocalNotifications.schedule({
          notifications: [
            {
              id,
              title: `⏰ تذكير بعادة: ${habit.name}`,
              body: `حان موعد إنجاز عادتك اليومية "${habit.name}"! حافظ على سلسلتك اليومية ✨`,
              schedule: {
                on: {
                  hour,
                  minute,
                },
                allowWhileIdle: true,
              },
              channelId: NOTIFICATION_CHANNEL_ID,
              sound: NOTIFICATION_SOUND_FILE,
              smallIcon: 'ic_stat_habit',
              iconColor: '#10B981',
              extra: { habitId: habit.id, habitName: habit.name },
            },
          ],
        });
      } catch (err) {
        console.warn('Failed to schedule single native reminder:', err);
      }
    }
  }

  public async cancelHabitReminder(habitId: string) {
    this.scheduledReminders.delete(habitId);
    this.lastHabitsHash = '';

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
   * Used for explicit triggers (like unlocking achievements or manual test button)
   */
  public async triggerNotification(title: string, body: string, habitName?: string, icon?: string) {
    // 0. Trigger audio chime alert
    soundService.playReminderAlert();

    const item: InAppNotification = {
      id: `notif_${Date.now()}_${Math.random()}`,
      title,
      body,
      habitName,
      icon,
      timestamp: Date.now(),
    };

    // 1. In-app toast listeners
    this.listeners.forEach((listener) => {
      try {
        listener(item);
      } catch (err) {
        console.warn('Notification listener error:', err);
      }
    });

    // 2. Native System Notification (immediate)
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
                at: new Date(Date.now() + 400),
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
   * Foreground checker: Fires in-app notification ONLY when the exact minute arrives right now.
   * Tracks date+time to ensure it only fires once per day per habit!
   */
  private startInAppReminderChecker() {
    if (typeof window === 'undefined') return;

    let lastCheckedMinute = '';

    this.timer = window.setInterval(() => {
      const now = new Date();
      const currentMinute = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      if (currentMinute === lastCheckedMinute) return;
      lastCheckedMinute = currentMinute;

      // Only evaluate when active in foreground on Web or desktop
      // (On Native Android, AlarmManager will handle background/lock screen)
      if (this.isNative) return;

      this.scheduledReminders.forEach((reminder, habitId) => {
        if (reminder.time === currentMinute) {
          const firedKey = `${habitId}_${todayDate}_${currentMinute}`;
          if (this.lastFiredTracker.get(habitId) === firedKey) {
            return; // Already fired today for this minute
          }
          this.lastFiredTracker.set(habitId, firedKey);

          this.triggerNotification(
            `⏰ تذكير بعادة: ${reminder.name}`,
            `حان موعد إنجاز عادتك اليومية "${reminder.name}"! حافظ على سلسلتك اليومية ✨`,
            habitId
          );
        }
      });
    }, 10000); // Check every 10 seconds
  }
}

export const notificationService = new NotificationService();
