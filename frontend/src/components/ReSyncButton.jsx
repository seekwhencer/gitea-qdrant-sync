import { useState } from 'react';
import { syncAll } from '../api/client';

export default function ReSyncButton() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(null);

  const handleClick = async () => {
    setPending(true);
    setMessage(null);
    try {
      await syncAll();
      setMessage('Re-Sync of all repositories started in the background.');
    } catch (error) {
      setMessage(error.message || 'Re-Sync failed.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="re-sync">
      {message && (
        <p className="re-sync__message">{message}</p>
      )}
      <button
        className="re-sync__button"
        type="button"
        disabled={pending}
        onClick={handleClick}
      >
        {pending ? (
          <>
            <span className="re-sync__spinner" aria-hidden="true" />
            Re-Sync in progress…
          </>
        ) : (
          'Gitea Re-Sync'
        )}
      </button>
    </div>
  );
}
