import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

declare global {
	namespace App {
		interface Error {
			message: string;
			code?: string;
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
