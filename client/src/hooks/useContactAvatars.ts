'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores';
import { profileApi, filesApi } from '@/lib/api';
import { downloadAndCacheAvatar, getCachedAvatarUrl } from '@/lib/avatarCache';
import type { Contact } from '@/crypto/storage';

/**
 * Loads avatars for a list of contacts.
 * Returns a Map<contactId, objectURL>.
 */
export function useContactAvatars(contacts: Contact[]): Record<string, string> {
  const identityKeys = useAuthStore((s) => s.identityKeys);
  const [avatarMap, setAvatarMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!identityKeys || contacts.length === 0) return;
    let cancelled = false;

    (async () => {
      for (const contact of contacts) {
        if (cancelled) break;

        try {
          const res = await profileApi.get(contact.id, identityKeys);
          if (cancelled || !res.data?.avatarFileId) continue;

          const fid = res.data.avatarFileId;
          const cached = getCachedAvatarUrl(fid);
          if (cached) {
            setAvatarMap((prev) => ({ ...prev, [contact.id]: cached }));
            continue;
          }

          const keys = identityKeys;
          const url = await downloadAndCacheAvatar(fid, async () => {
            const r = await filesApi.download(fid, keys);
            if (!r.data) return null;
            return { data: r.data.data, mimeHint: r.data.mimeHint };
          });
          if (!cancelled && url) {
            setAvatarMap((prev) => ({ ...prev, [contact.id]: url }));
          }
        } catch {
          // Best effort — skip this contact
        }
      }
    })();

    return () => { cancelled = true; };
  }, [contacts, identityKeys]);

  return avatarMap;
}
