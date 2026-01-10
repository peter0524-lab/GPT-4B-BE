import Memo from '../models/Memo.model.js';
import PreferenceProfile from '../models/PreferenceProfile.model.js';
import PreferenceEvent from '../models/PreferenceEvent.model.js';
import { extractPreferencesFromMemo } from './llm.service.js';

/**
 * Process memos and extract preferences
 */
export const processMemosForPreference = async (businessCardId, limit = 50) => {
  try {
    // Load latest N memos for the business card
    const memos = await Memo.findByBusinessCardId(businessCardId, null);
    const recentMemos = memos.slice(0, limit);

    if (recentMemos.length === 0) {
      // No memos, return empty profile
      await PreferenceProfile.upsert(businessCardId, {
        likes: [],
        dislikes: [],
        uncertain: [],
        lastSourceCount: 0
      });
      return { likes: [], dislikes: [], uncertain: [] };
    }

    // Delete existing events for rebuild
    await PreferenceEvent.deleteByBusinessCardId(businessCardId);

    // Aggregate preferences from all memos
    const aggregatedPreferences = {
      likes: new Map(), // key: item, value: { evidence: Set, count: number }
      dislikes: new Map(),
      uncertain: new Map()
    };

    // Process each memo
    for (const memo of recentMemos) {
      if (!memo.content || memo.content.trim() === '') continue;

      try {
        const extracted = await extractPreferencesFromMemo(memo.content);

        // Process likes
        for (const like of extracted.likes || []) {
          if (!like.item || !like.evidence || !Array.isArray(like.evidence)) continue;

          const key = like.item.trim().toLowerCase();
          if (!aggregatedPreferences.likes.has(key)) {
            aggregatedPreferences.likes.set(key, {
              item: like.item,
              evidence: new Set(),
              count: 0
            });
          }

          const existing = aggregatedPreferences.likes.get(key);
          like.evidence.forEach(ev => {
            if (ev && ev.trim()) existing.evidence.add(ev.trim());
          });
          existing.count += 1;

          // Save event (before aggregation update to use correct confidence)
          const confidenceBefore = Math.min(0.5 + ((existing.count - 1) * 0.1), 1.0);
          await PreferenceEvent.create({
            businessCardId: memo.business_card_id,
            memoId: memo.id,
            polarity: 'like',
            item: like.item,
            evidence: Array.isArray(like.evidence) ? like.evidence.join(' | ') : String(like.evidence || ''),
            confidence: confidenceBefore
          });
        }

        // Process dislikes
        for (const dislike of extracted.dislikes || []) {
          if (!dislike.item || !dislike.evidence || !Array.isArray(dislike.evidence)) continue;

          const key = dislike.item.trim().toLowerCase();
          if (!aggregatedPreferences.dislikes.has(key)) {
            aggregatedPreferences.dislikes.set(key, {
              item: dislike.item,
              evidence: new Set(),
              count: 0
            });
          }

          const existing = aggregatedPreferences.dislikes.get(key);
          dislike.evidence.forEach(ev => {
            if (ev && ev.trim()) existing.evidence.add(ev.trim());
          });
          existing.count += 1;

          // Save event (before aggregation update to use correct confidence)
          const confidenceBefore = Math.min(0.5 + ((existing.count - 1) * 0.1), 1.0);
          await PreferenceEvent.create({
            businessCardId: memo.business_card_id,
            memoId: memo.id,
            polarity: 'dislike',
            item: dislike.item,
            evidence: Array.isArray(dislike.evidence) ? dislike.evidence.join(' | ') : String(dislike.evidence || ''),
            confidence: confidenceBefore
          });
        }

        // Process uncertain
        for (const unc of extracted.uncertain || []) {
          if (!unc.item || !unc.evidence || !Array.isArray(unc.evidence)) continue;

          const key = unc.item.trim().toLowerCase();
          if (!aggregatedPreferences.uncertain.has(key)) {
            aggregatedPreferences.uncertain.set(key, {
              item: unc.item,
              evidence: new Set(),
              count: 0
            });
          }

          const existing = aggregatedPreferences.uncertain.get(key);
          unc.evidence.forEach(ev => {
            if (ev && ev.trim()) existing.evidence.add(ev.trim());
          });
          existing.count += 1;

          // Save event
          await PreferenceEvent.create({
            businessCardId: memo.business_card_id,
            memoId: memo.id,
            polarity: 'uncertain',
            item: unc.item,
            evidence: Array.isArray(unc.evidence) ? unc.evidence.join(' | ') : String(unc.evidence || ''),
            confidence: 0.5
          });
        }
      } catch (error) {
        console.error(`Error processing memo ${memo.id}:`, error);
        // Continue with next memo
      }
    }

    // Convert Maps to arrays and calculate weights
    const likes = Array.from(aggregatedPreferences.likes.values()).map(item => ({
      item: item.item,
      evidence: Array.from(item.evidence),
      weight: Math.min(0.5 + (item.count * 0.1), 1.0)
    }));

    const dislikes = Array.from(aggregatedPreferences.dislikes.values()).map(item => ({
      item: item.item,
      evidence: Array.from(item.evidence),
      weight: Math.min(0.5 + (item.count * 0.1), 1.0)
    }));

    const uncertain = Array.from(aggregatedPreferences.uncertain.values()).map(item => ({
      item: item.item,
      evidence: Array.from(item.evidence),
      weight: 0.5
    }));

    // Upsert profile
    await PreferenceProfile.upsert(businessCardId, {
      likes,
      dislikes,
      uncertain,
      lastSourceCount: recentMemos.length
    });

    return { likes, dislikes, uncertain };
  } catch (error) {
    console.error('Error processing preferences:', error);
    throw error;
  }
};
