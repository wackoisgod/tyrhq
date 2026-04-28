<script lang="ts">
	import { page } from '$app/state';

	const items = [
		{ href: '/settings', label: 'Profile' },
		{ href: '/settings/api', label: 'Developer API' }
	];

	const isActive = (href: string) => page.url.pathname === href;
</script>

<nav class="settings-tabs" aria-label="Settings sections">
	{#each items as item}
		<a
			href={item.href}
			aria-current={isActive(item.href) ? 'page' : undefined}
			class="settings-tab"
			class:settings-tab--active={isActive(item.href)}
		>
			{item.label}
		</a>
	{/each}
</nav>
