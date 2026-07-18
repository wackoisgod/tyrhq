<script lang="ts">
	import { siteCopy } from '$lib/content/site';

	const trailerEmbedUrl = 'https://www.youtube-nocookie.com/embed/1Wy-s8ps6vU?rel=0';

	const overviewSections = [
		{
			title: 'Tanks',
			body: 'Tyr features a roster of specialized armored vehicles and pilots. You will take control of treaded and hover tanks alike as you angle and position for defense, then rumble and glide across the battlefield.'
		},
		{
			title: 'Customization',
			body: 'Each vehicle offers its own tech tree plus ammo and component slots, giving you room to upgrade and evolve your ride around your playstyle. You may even be able to change up a vehicle’s keystone tech to alter your personal meta.'
		},
		{
			title: 'Abilities',
			body: 'Every vehicle features a unique power that impacts Tyr’s moment-to-moment combat. A tank may blink forward or back, send out a sonar pulse to spot enemies, or overcharge its engine to ram directly into an opponent.'
		},
		{
			title: 'Asymmetric Vision',
			body: 'In Tyr, you and your opponents are only visible when within range or while making enough noise. Deciding when to push, when to fire, and when to hold cover can mean the difference between staying hidden and revealing your position to the entire enemy team.'
		},
		{
			title: 'Strategy',
			body: 'Tyr rewards mental mettle, patience, and teamwork. Deliberate play beats whoever can simply fire the fastest.'
		}
	];

	const features = [
		'Multiplayer tank shooter focused on strategic team battles with heavy-armored vehicles.',
		'A roster of heavy armor with unique profiles you can angle and position to deflect shots.',
		'Vehicle customization through individual tech trees, ammo slots, and component upgrades.',
		'Keystone tech variations that unlock meta-changing choices at max level.',
		'Asymmetric vision that rewards cover, patience, and information control.',
		'Unique vehicle abilities that make moment-to-moment play more high-stakes and varied.',
		'Strategy-first combat where careful positioning and slow, disciplined shots win.'
	];
</script>

<svelte:head>
	<title>Tyr HQ | Game</title>
	<meta
		name="description"
		content="Welcome to Tyr: a multiplayer tank shooter where positioning, strategic decision-making, and mastery of unique abilities win."
	/>
</svelte:head>

<section class="mx-auto max-w-5xl px-4 py-10 md:px-6 md:py-12">
	<div class="rounded-sm bg-[var(--hud-panel)] p-6 md:p-8" style="box-shadow: var(--hud-surface-ghost);">
		<div class="mx-auto max-w-3xl">
			<h1 class="text-center text-4xl font-semibold text-[var(--hud-text)] md:text-5xl">
				Welcome to Tyr.
			</h1>
			<p class="mx-auto mt-4 max-w-2xl text-center text-base leading-7 text-[var(--hud-muted)]">
				Tyr is a multiplayer tank shooter. Pilot heavy-armored vehicles with unique capabilities
				and upgrade them as you battle for victory with your team.
			</p>

			<div class="mt-8 overflow-hidden rounded-sm ring-1 ring-[var(--hud-outline-variant)]">
				<div class="aspect-video bg-[var(--hud-surface)]">
					<iframe
						class="h-full w-full"
						src={trailerEmbedUrl}
						title="Tyr official trailer"
						allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
						referrerpolicy="strict-origin-when-cross-origin"
						allowfullscreen
					></iframe>
				</div>
			</div>

			<div class="mt-6 flex justify-center">
				<a
					href={siteCopy.wishlistUrl}
					target="_blank"
					rel="noreferrer"
					class="hud-cta px-5 py-3"
				>
					Wishlist on Steam
				</a>
			</div>

			<p class="mt-8 text-sm leading-7 text-[var(--hud-muted)] md:text-base">
				This is Tyr, a tank shooter where positioning, strategic decision-making, and mastery of
				unique abilities win.
			</p>

			<div class="mt-10 space-y-8">
				{#each overviewSections as section}
					<div>
						<h2 class="hud-headline text-2xl font-semibold text-[var(--hud-text)]">
							{section.title}
						</h2>
						<p class="mt-3 text-sm leading-7 text-[var(--hud-muted)] md:text-base">
							{section.body}
						</p>
					</div>
				{/each}
			</div>

			<div class="mt-10">
				<h2 class="hud-headline text-2xl font-semibold text-[var(--hud-text)]">Features</h2>
				<ul class="mt-4 space-y-3 pl-5 text-sm leading-7 text-[var(--hud-muted)] md:text-base">
					{#each features as feature}
						<li class="list-disc">{feature}</li>
					{/each}
				</ul>
			</div>

			<div class="mt-10 flex justify-center">
				<a
					href={siteCopy.playtestUrl}
					target="_blank"
					rel="noreferrer"
					class="hud-cta-outline px-5 py-3"
				>
					Play Now
				</a>
			</div>
		</div>
	</div>
</section>
