import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

type PrivilegedRole = 'admin' | 'moderator' | 'support_agent' | null;

export const useAdmin = () => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [role, setRole] = useState<PrivilegedRole>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          setRole(null);
          setIsAdmin(false);
          setIsLoading(false);
          return;
        }

        const { data, error } = await supabase.functions.invoke('admin', {
          body: { action: 'authorize' },
        });

        if (error) {
          const status = (error as any)?.context?.status;
          if (status !== 403) {
            console.error('Error checking admin status:', error);
          }
          setRole(null);
          setIsAdmin(false);
        } else {
          const resolvedRole = (data?.role ?? null) as PrivilegedRole;
          setRole(resolvedRole);
          setIsAdmin(Boolean(data?.authorized));
        }
      } catch (err) {
        console.error('Error checking admin status:', err);
        setRole(null);
        setIsAdmin(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkAdminStatus();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      checkAdminStatus();
    });

    return () => subscription.unsubscribe();
  }, []);

  return { isAdmin, role, isLoading };
};
