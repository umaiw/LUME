/**
 * Shared hook: add-contact + open-chat-for-contact logic.
 * Eliminates copy-paste between chats/page.tsx and chat/[id]/page.tsx.
 */

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { useAuthStore, useContactsStore, useChatsStore } from "@/stores";
import { authApi } from "@/lib/api";
import { saveContacts, type Contact } from "@/crypto/storage";

export function useContactActions() {
  const router = useRouter();
  const { username, masterKey, identityKeys } = useAuthStore();
  const { addContact } = useContactsStore();
  const { addChat, setActiveChat } = useChatsStore();

  const [showAddContact, setShowAddContact] = useState(false);
  const [newContactUsername, setNewContactUsername] = useState("");
  const [addContactError, setAddContactError] = useState("");
  const [addContactLoading, setAddContactLoading] = useState(false);

  const openChatForContact = useCallback(
    (contactId: string) => {
      const existing = useChatsStore
        .getState()
        .chats.find((c) => c.contactId === contactId);
      let chatId = existing?.id;
      if (!chatId) {
        chatId = uuidv4();
        addChat({
          id: chatId,
          contactId,
          messages: [],
          unreadCount: 0,
          isHidden: false,
        });
      }
      setActiveChat(chatId);
      router.push(`/chat/${chatId}`);
    },
    [addChat, setActiveChat, router],
  );

  const handleAddContact = useCallback(async () => {
    setAddContactError("");
    setAddContactLoading(true);

    try {
      const normalized = newContactUsername.trim();
      if (!identityKeys) {
        setAddContactError("Not authenticated");
        return;
      }
      const { data, error } = await authApi.getUser(normalized, identityKeys);
      if (error || !data) {
        setAddContactError("User not found");
        return;
      }

      if (data.username === username) {
        setAddContactError("Cannot add yourself");
        return;
      }

      if (
        useContactsStore
          .getState()
          .contacts.some((c) => c.username === data.username)
      ) {
        setAddContactError("Contact already added");
        return;
      }

      const newContact: Contact = {
        id: data.id,
        username: data.username,
        publicKey: data.identityKey,
        exchangeKey:
          data.exchangeIdentityKey || data.exchangeKey || data.signedPrekey,
        addedAt: Date.now(),
      };

      addContact(newContact);
      const updatedContacts = useContactsStore.getState().contacts;

      if (masterKey) {
        await saveContacts(updatedContacts, masterKey);
      }

      setShowAddContact(false);
      setNewContactUsername("");

      openChatForContact(data.id);
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') console.error("Add contact error:", e);
      setAddContactError("Error adding contact");
    } finally {
      setAddContactLoading(false);
    }
  }, [newContactUsername, username, masterKey, identityKeys, addContact, openChatForContact]);

  const resetAddContact = useCallback(() => {
    setShowAddContact(false);
    setNewContactUsername("");
    setAddContactError("");
  }, []);

  return {
    showAddContact,
    setShowAddContact,
    newContactUsername,
    setNewContactUsername,
    addContactError,
    addContactLoading,
    handleAddContact,
    openChatForContact,
    resetAddContact,
  };
}
