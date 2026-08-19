'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

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
      <button className="nl-button" type="submit">
        Open claim
      </button>
    </form>
  );
}
