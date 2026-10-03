import { HabitCategory } from '../types';
import { TranslationKey } from '../i18n/translations';

export interface CategoryInfo {
  id: HabitCategory;
  labelKey: TranslationKey;
  emoji: string;
  color: string;
  badgeClass: string;
  pillSelectedClass: string;
  pillUnselectedClass: string;
}

export const CATEGORIES: CategoryInfo[] = [
  {
    id: 'health',
    labelKey: 'category_health' as TranslationKey,
    emoji: '🌿',
    color: '#10b981',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200/90 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60',
    pillSelectedClass: 'bg-emerald-600 text-white shadow-xs',
    pillUnselectedClass: 'bg-emerald-50/80 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/40',
  },
  {
    id: 'work',
    labelKey: 'category_work' as TranslationKey,
    emoji: '💼',
    color: '#3b82f6',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200/90 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800/60',
    pillSelectedClass: 'bg-blue-600 text-white shadow-xs',
    pillUnselectedClass: 'bg-blue-50/80 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/40',
  },
  {
    id: 'personal',
    labelKey: 'category_personal' as TranslationKey,
    emoji: '👤',
    color: '#8b5cf6',
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-200/90 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800/60',
    pillSelectedClass: 'bg-purple-600 text-white shadow-xs',
    pillUnselectedClass: 'bg-purple-50/80 text-purple-700 hover:bg-purple-100 dark:bg-purple-950/30 dark:text-purple-300 border border-purple-200/60 dark:border-purple-800/40',
  },
  {
    id: 'fitness',
    labelKey: 'category_fitness' as TranslationKey,
    emoji: '🏃',
    color: '#f97316',
    badgeClass: 'bg-orange-50 text-orange-700 border-orange-200/90 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-800/60',
    pillSelectedClass: 'bg-orange-600 text-white shadow-xs',
    pillUnselectedClass: 'bg-orange-50/80 text-orange-700 hover:bg-orange-100 dark:bg-orange-950/30 dark:text-orange-300 border border-orange-200/60 dark:border-orange-800/40',
  },
  {
    id: 'learning',
    labelKey: 'category_learning' as TranslationKey,
    emoji: '📚',
    color: '#eab308',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200/90 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60',
    pillSelectedClass: 'bg-amber-600 text-white shadow-xs',
    pillUnselectedClass: 'bg-amber-50/80 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40',
  },
  {
    id: 'mindfulness',
    labelKey: 'category_mindfulness' as TranslationKey,
    emoji: '🧘',
    color: '#06b6d4',
    badgeClass: 'bg-cyan-50 text-cyan-700 border-cyan-200/90 dark:bg-cyan-950/50 dark:text-cyan-300 dark:border-cyan-800/60',
    pillSelectedClass: 'bg-cyan-600 text-white shadow-xs',
    pillUnselectedClass: 'bg-cyan-50/80 text-cyan-700 hover:bg-cyan-100 dark:bg-cyan-950/30 dark:text-cyan-300 border border-cyan-200/60 dark:border-cyan-800/40',
  },
  {
    id: 'finance',
    labelKey: 'category_finance' as TranslationKey,
    emoji: '💰',
    color: '#14b8a6',
    badgeClass: 'bg-teal-50 text-teal-700 border-teal-200/90 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800/60',
    pillSelectedClass: 'bg-teal-600 text-white shadow-xs',
    pillUnselectedClass: 'bg-teal-50/80 text-teal-700 hover:bg-teal-100 dark:bg-teal-950/30 dark:text-teal-300 border border-teal-200/60 dark:border-teal-800/40',
  },
  {
    id: 'other',
    labelKey: 'category_other' as TranslationKey,
    emoji: '🏷️',
    color: '#64748b',
    badgeClass: 'bg-stone-100 text-stone-700 border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700',
    pillSelectedClass: 'bg-stone-700 text-white shadow-xs',
    pillUnselectedClass: 'bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-400 border border-stone-200 dark:border-stone-700',
  },
];

export function getCategoryInfo(category?: string): CategoryInfo {
  if (!category) return CATEGORIES[0];
  const normalized = category.toLowerCase().trim();
  const found = CATEGORIES.find((c) => c.id === normalized);
  if (found) return found;
  if (normalized === 'wellness') return CATEGORIES.find((c) => c.id === 'mindfulness') || CATEGORIES[0];
  return CATEGORIES[0];
}
