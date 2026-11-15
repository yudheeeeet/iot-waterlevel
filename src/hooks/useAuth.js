import { useEffect, useState } from 'react';
import { authService } from '../services/authService';

/**
 * Current user. On first load the session is restored from the refresh cookie (if any);
 * `ready` is false until that check finishes, so the login page does not flash.
 */
export function useAuth() {
  const [user, setUser] = useState(authService.getUser());
  const [ready, setReady] = useState(!!authService.getUser());

  useEffect(() => {
    const off = authService.onChange(setUser);
    if (!authService.getUser()) {
      authService.refresh().finally(() => {
        setUser(authService.getUser());
        setReady(true);
      });
    }
    return off;
  }, []);

  return { user, ready, isAdmin: user?.role === 'admin', logout: authService.logout };
}
