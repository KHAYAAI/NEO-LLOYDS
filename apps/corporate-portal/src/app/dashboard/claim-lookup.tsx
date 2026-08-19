'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * There is no "list my claims" endpoint (only `GET /claims/by-syndication/:id`
 * and `GET /claims/:id`), so this is a direct lookup by claim id — an honest
 * reflection of what the API actually supports, not an invented list view.
 */
export function ClaimLookup() {
  const router = useRouter();
  const [id, setId] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (id.trim()) router.push(`/claims/${id.trim()}`);
      }}
      style={{ display: 'flex', gap: 8 }}
    >
      <input
        type="text"
        placeholder="Claim id"
        value={id}
        onChange={(e) => setId(e.target.value)}
        style={{ flex: 1 }}
      />
      <button className="nl-button nl-button-secondary" type="submit">
        View claim
      </button>
    </form>
  );
}
