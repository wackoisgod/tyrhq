import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

declare global {
	namespace App {
		interface Error {
			message: string;
			code?: string;
			// Set on the 410 thrown by the public [slug] routes when an article
			// exists but has been withdrawn, so +error.svelte can render the
			// "withdrawn" notice instead of the generic error page.
			withdrawn?: boolean;
			title?: string;
			backHref?: string;
			backLabel?: string;
		}
		interface Locals {
			supabase: SupabaseClient;
			safeGetSession: () => Promise<{
				session: Session | null;
				user: User | null;
				role: 'user' | 'contributor' | 'admin';
			}>;
		}
		interface PageData {
			session: Session | null;
			user: User | null;
			role?: 'user' | 'contributor' | 'admin';
			isTournamentOrganizer?: boolean;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

declare module '*.md' {
	import type { Component } from 'svelte';
	const component: Component<Record<string, never>>;
	export default component;
	export const metadata: Record<string, unknown> | undefined;
}

export {};
