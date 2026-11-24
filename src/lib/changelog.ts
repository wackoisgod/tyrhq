// Public Tyr HQ changelog. Newest first.
// Adding a release is a one-file edit: put a new entry at the top.
// Write for players. Game balance notes belong on Patch Notes, not here.
// Full rules: AGENTS.md (Changelog).

export type ChangelogTag = 'New' | 'Improved' | 'Fixed';

export type ChangelogItem = {
	tag: ChangelogTag;
	text: string;
};

export type ChangelogEntry = {
	/** ISO date (YYYY-MM-DD) the release landed. */
	date: string;
	title: string;
	items: ChangelogItem[];
};

export const changelog: ChangelogEntry[] = [
	{
		date: '2026-11-24',
		title: 'Tournaments',
		items: [
			{
				tag: 'New',
				text: 'You get an email when an organizer application is approved or declined, including any note left on a declined application.'
			},
			{
				tag: 'New',
				text: 'You get a notification in the header when an organizer application is approved or declined, and when organizer access is removed.'
			},
			{
				tag: 'New',
				text: 'Apply from Settings to organize tournaments. Once approved, you can publish an event right away, and your application status stays on Settings.'
			},
			{
				tag: 'Improved',
				text: 'A tournament can be taken off the public list without deleting its results.'
			},
			{
				tag: 'New',
				text: 'Create a tournament and register a team. Organizers can rank the field, generate a bracket, and record results, including a quick result for a series.'
			},
			{
				tag: 'New',
				text: 'Register as a free agent when you are looking for a team.'
			},
			{
				tag: 'New',
				text: 'Follow current standings while an event is running, and the final results when it is finished. Team logos show on the bracket.'
			},
			{
				tag: 'New',
				text: 'Each tournament lists player loadouts. Finished events mark where a team placed.'
			},
			{
				tag: 'Improved',
				text: 'Search teams and ask to join one. Rosters can include a captain, a co-captain, and substitutes, and the tournament win-loss record is listed on its own.'
			},
			{
				tag: 'New',
				text: 'Add Discord and Steam links to your profile so captains can reach you.'
			},
			{
				tag: 'New',
				text: 'Sign in with Steam. Link Google or an email and password from settings, and your Steam name updates each time you sign in. You can unlink a sign-in as long as another one is still on the account.'
			},
			{
				tag: 'New',
				text: 'If you already have another Tyr HQ account, add that sign-in and merge them into one. You can undo a merge.'
			},
			{
				tag: 'New',
				text: 'Upload a match replay and the scoreboard and map are filled in from the file.'
			},
			{
				tag: 'Improved',
				text: 'A tournament shows the start time in your time zone, how many teams can register, any prize note, and the score a round is played to.'
			},
			{
				tag: 'Fixed',
				text: 'Tournament pages open when they include a start time. Cancelled events stay off the public list, and placement labels use the right ending.'
			},
			{
				tag: 'Fixed',
				text: 'Linking an email while combining accounts no longer changes your password, and the note after saving a series matches the score that was saved.'
			}
		]
	},
	{
		date: '2026-10-21',
		title: 'Firepower',
		items: [
			{
				tag: 'New',
				text: 'The planner, tank pages, and the comparison tool show damage per minute, burst damage, and cycle time.'
			},
			{
				tag: 'New',
				text: 'Open a firepower breakdown to see the damage and reload math, and how much of the damage per minute comes from each ammo choice, component, and talent.'
			},
			{
				tag: 'Fixed',
				text: 'Redirector Gear no longer doubles more as max stacks go up.'
			},
			{
				tag: 'Fixed',
				text: 'The Friction Capacitor landing burst only counts when its conditions are met.'
			}
		]
	},
	{
		date: '2026-10-09',
		title: 'Ability cost on tank pages',
		items: [
			{
				tag: 'New',
				text: 'The tank overview shows the base cost of its ability.'
			}
		]
	},
	{
		date: '2026-09-24',
		title: 'In-game share codes',
		items: [
			{
				tag: 'New',
				text: 'Paste an in-game share code into the planner. If a code names a part the site no longer knows, the rest of the build still loads.'
			},
			{
				tag: 'Improved',
				text: 'Ammo chips are colored by whether a lower number is good or bad, so a dispersion cut reads as a buff.'
			}
		]
	},
	{
		date: '2026-09-07',
		title: 'Build cards',
		items: [
			{
				tag: 'Improved',
				text: 'A build card opens that loadout in the planner.'
			}
		]
	},
	{
		date: '2026-09-03',
		title: 'Tyr is in Early Access',
		items: [
			{
				tag: 'New',
				text: 'The home page announces that Tyr is live in Early Access.'
			}
		]
	},
	{
		date: '2026-08-28',
		title: 'Weight, module names, and article contents',
		items: [
			{
				tag: 'Improved',
				text: 'Vehicle weight and module names follow the latest game data, and the home page has a new hero image.'
			},
			{
				tag: 'Fixed',
				text: 'Article tables of contents show an ampersand instead of a raw code.'
			}
		]
	},
	{
		date: '2026-08-13',
		title: 'Playstyle notes',
		items: [
			{
				tag: 'New',
				text: 'Leave playstyle notes on a build, and keep a private notepad on each tank.'
			},
			{
				tag: 'Improved',
				text: 'Build notes support formatting, links to guides, and live stat references, and sit between the loadout and the stats. Anyone opening a shared build can read those notes.'
			}
		]
	},
	{
		date: '2026-08-08',
		title: 'Armor viewer on your phone',
		items: [
			{
				tag: 'Improved',
				text: 'The armor viewer works on a phone and with touch. Tap the hull to pin a readout for penetration, the module, and thickness.'
			}
		]
	},
	{
		date: '2026-08-03',
		title: 'Community events and alpha vehicles',
		items: [
			{
				tag: 'New',
				text: 'A community events calendar, with a month view, time zones, and a preview on the community hub.'
			},
			{
				tag: 'New',
				text: 'Sign in to submit an event, and edit one you submitted. Events are reviewed before they go on the calendar.'
			},
			{
				tag: 'Improved',
				text: 'Alpha vehicles are marked with a corner wedge on the roster and on build cards.'
			}
		]
	},
	{
		date: '2026-07-29',
		title: 'Compare tanks',
		items: [
			{
				tag: 'New',
				text: 'Compare tanks side by side, with the models lined up so you can judge scale.'
			},
			{
				tag: 'Fixed',
				text: 'Drift Sparker applies its stated 12 kph boost.'
			},
			{
				tag: 'Improved',
				text: 'The planner shows Relentless Adapter stacking and the Friction Capacitor landing boost.'
			}
		]
	},
	{
		date: '2026-07-28',
		title: 'Talents and stat breakdowns',
		items: [
			{
				tag: 'Fixed',
				text: 'Stat breakdowns and component values that players reported now show the right numbers.'
			},
			{
				tag: 'Improved',
				text: 'On a phone, hold a talent button to set it to the maximum.'
			},
			{
				tag: 'Fixed',
				text: 'Talent descriptions show percentages the way the game does, instead of raw decimals.'
			}
		]
	},
	{
		date: '2026-07-20',
		title: 'Community hub',
		items: [
			{
				tag: 'New',
				text: 'A community page for Discords, fan sites, and tools, including The Tyr Hotline.'
			},
			{
				tag: 'New',
				text: 'Community bulletins can appear in Latest Dispatches on the home page.'
			}
		]
	},
	{
		date: '2026-07-14',
		title: 'Article images',
		items: [
			{
				tag: 'Fixed',
				text: 'Image uploads in articles work again after the site moved to its own address.'
			},
			{
				tag: 'Fixed',
				text: 'Suggesting an edit works on articles that still use older image links.'
			}
		]
	},
	{
		date: '2026-06-30',
		title: 'Live game numbers in articles',
		items: [
			{
				tag: 'New',
				text: 'Articles can include live numbers from the current game data.'
			}
		]
	},
	{
		date: '2026-06-27',
		title: 'Map drawing layers',
		items: [
			{
				tag: 'New',
				text: 'The map planner has drawing layers you can reorder, and a move mode for a whole layer.'
			},
			{
				tag: 'New',
				text: 'Pinch to zoom the map planner on a touch screen.'
			}
		]
	},
	{
		date: '2026-06-25',
		title: 'Article table of contents',
		items: [
			{
				tag: 'New',
				text: 'Articles have a linked table of contents. On a wide screen it stays in a side rail.'
			},
			{
				tag: 'Fixed',
				text: 'Heading links work on older articles too.'
			}
		]
	},
	{
		date: '2026-06-20',
		title: 'Hit points on tank cards',
		items: [
			{
				tag: 'Improved',
				text: 'Tank cards on the tanks page list hit points.'
			}
		]
	},
	{
		date: '2026-06-09',
		title: 'Armor colors',
		items: [
			{
				tag: 'Improved',
				text: 'Armor module colors line up across the viewer.'
			}
		]
	},
	{
		date: '2026-06-01',
		title: 'Treads, VTOL, and stat fixes',
		items: [
			{
				tag: 'New',
				text: 'Treaded vehicles animate in the armor viewer.'
			},
			{
				tag: 'Fixed',
				text: 'A deployed VTOL stays in one piece when it animates.'
			},
			{
				tag: 'Fixed',
				text: 'Ability cooldown math is corrected, and Catalytic Reservoir no longer changes penetration.'
			},
			{
				tag: 'Improved',
				text: 'Lightweight and Unstable rounds show how they change ammo speed.'
			}
		]
	},
	{
		date: '2026-05-29',
		title: 'Difficulty ratings',
		items: [
			{
				tag: 'New',
				text: 'Tank cards and tank pages show a difficulty rating.'
			}
		]
	},
	{
		date: '2026-05-26',
		title: 'Suggested edits',
		items: [
			{
				tag: 'New',
				text: 'Reviewers can suggest edits directly on an article.'
			}
		]
	},
	{
		date: '2026-05-18',
		title: 'Gearing, talents, and keystones',
		items: [
			{
				tag: 'Fixed',
				text: 'Extended Gearing uses the right math, and the preview of a talent at max rank matches.'
			},
			{
				tag: 'Fixed',
				text: 'Components that multiply by a percent show that percent.'
			},
			{
				tag: 'Improved',
				text: 'A keystone you have not picked looks different from the one you have.'
			}
		]
	},
	{
		date: '2026-05-17',
		title: 'Deployed animations',
		items: [
			{
				tag: 'New',
				text: 'The armor viewer can play deployed vehicle animations.'
			}
		]
	},
	{
		date: '2026-05-15',
		title: 'Images, maps, and tank pages',
		items: [
			{
				tag: 'Improved',
				text: 'Article images can be up to 10 MB.'
			},
			{
				tag: 'New',
				text: 'Reviewers and contributors share one image library.'
			},
			{
				tag: 'Fixed',
				text: 'The map canvas keeps up when the window size or the screen sharpness changes.'
			},
			{
				tag: 'Improved',
				text: 'Colors on the tanks page are more consistent, and component text shows the right values.'
			},
			{
				tag: 'Fixed',
				text: 'Bonus energy gain is corrected in the cases that were off.'
			}
		]
	},
	{
		date: '2026-05-12',
		title: 'Live map rooms',
		items: [
			{
				tag: 'Improved',
				text: 'Arrows in a live map room render and scale correctly, and you can switch maps from the room.'
			},
			{
				tag: 'Fixed',
				text: 'A live room counts the host once.'
			}
		]
	},
	{
		date: '2026-05-11',
		title: 'Pinned guides and small fixes',
		items: [
			{
				tag: 'New',
				text: 'Guides can be pinned to the top of the guides page.'
			},
			{
				tag: 'Fixed',
				text: 'The header no longer leaves a gap on a phone.'
			},
			{
				tag: 'Fixed',
				text: 'Shell swap time is read correctly.'
			},
			{
				tag: 'Fixed',
				text: 'A max-stacks bug in the planner is fixed.'
			}
		]
	},
	{
		date: '2026-05-04',
		title: 'Patch notes and abilities',
		items: [
			{
				tag: 'New',
				text: 'Patch notes have their own page, separate from the rest of the home feed.'
			},
			{
				tag: 'New',
				text: 'Tank pages include ability information.'
			},
			{
				tag: 'New',
				text: 'The home page lists the latest guides and articles.'
			},
			{
				tag: 'Fixed',
				text: 'The name in the header matches the account you are signed in with.'
			}
		]
	},
	{
		date: '2026-05-01',
		title: 'Shared builds and planner math',
		items: [
			{
				tag: 'Fixed',
				text: 'The planner applies flat bonuses before percent bonuses.'
			},
			{
				tag: 'New',
				text: 'Browse shared builds by top or new, and filter the list to one vehicle.'
			},
			{
				tag: 'Improved',
				text: 'Articles can include tables.'
			},
			{
				tag: 'Improved',
				text: 'The game page has an updated trailer.'
			}
		]
	},
	{
		date: '2026-04-30',
		title: 'Tyr HQ opens',
		items: [
			{
				tag: 'New',
				text: 'Browse tanks, components, and maps, plan a build, and inspect armor.'
			},
			{
				tag: 'New',
				text: 'Read and write articles and guides. A suggestion shows what changed, and a rejected article can be sent in again.'
			},
			{
				tag: 'New',
				text: 'Sign in to save builds, and browse builds other players have shared.'
			},
			{
				tag: 'New',
				text: 'Draw on a map, and join a live map room.'
			},
			{
				tag: 'New',
				text: 'Look up shells, and open Components, Shells, and Maps from the Resources menu.'
			},
			{
				tag: 'Improved',
				text: 'Articles and guides show who wrote them, and articles can include images.'
			},
			{
				tag: 'Fixed',
				text: 'Selecting a shell works, ammo names read correctly, and component descriptions show their numbers. The Resources menu stays in front of the page header.'
			}
		]
	}
];
