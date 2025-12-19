
// this file is generated — do not edit it


declare module "svelte/elements" {
	export interface HTMLAttributes<T> {
		'data-sveltekit-keepfocus'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-noscroll'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-preload-code'?:
			| true
			| ''
			| 'eager'
			| 'viewport'
			| 'hover'
			| 'tap'
			| 'off'
			| undefined
			| null;
		'data-sveltekit-preload-data'?: true | '' | 'hover' | 'tap' | 'off' | undefined | null;
		'data-sveltekit-reload'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-replacestate'?: true | '' | 'off' | undefined | null;
	}
}

export {};


declare module "$app/types" {
	export interface AppTypes {
		RouteId(): "/" | "/api" | "/api/fog" | "/api/fog/[id].png" | "/api/library" | "/api/maps" | "/api/state" | "/api/tokens" | "/api/upload-map" | "/api/upload-token" | "/gm" | "/player";
		RouteParams(): {
			"/api/fog/[id].png": { id: string }
		};
		LayoutParams(): {
			"/": { id?: string };
			"/api": { id?: string };
			"/api/fog": { id?: string };
			"/api/fog/[id].png": { id: string };
			"/api/library": Record<string, never>;
			"/api/maps": Record<string, never>;
			"/api/state": Record<string, never>;
			"/api/tokens": Record<string, never>;
			"/api/upload-map": Record<string, never>;
			"/api/upload-token": Record<string, never>;
			"/gm": Record<string, never>;
			"/player": Record<string, never>
		};
		Pathname(): "/" | "/api" | "/api/" | "/api/fog" | "/api/fog/" | `/api/fog/${string}.png` & {} | `/api/fog/${string}.png/` & {} | "/api/library" | "/api/library/" | "/api/maps" | "/api/maps/" | "/api/state" | "/api/state/" | "/api/tokens" | "/api/tokens/" | "/api/upload-map" | "/api/upload-map/" | "/api/upload-token" | "/api/upload-token/" | "/gm" | "/gm/" | "/player" | "/player/";
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): "/.DS_Store" | "/debug-icon-size_24.png" | "/fog/.gitkeep" | "/fog/83c68575-8827-45d3-9315-ca0ba0771703.png" | "/fog/8afdffab-2110-413a-a7fa-054694e48a4b.png" | "/fog/92483516-9adf-4a20-a318-3767ef8e9f88.png" | "/fog/936995be-ac70-40ca-8ac7-2c8e07dfdf74.png" | "/fog/99a286a1-4930-4fe1-b68f-82de0c137e0d.png" | "/icons/skills.svg" | "/maps/.DS_Store" | "/maps/default.jpg" | "/maps/uploads/.DS_Store" | "/maps/uploads/1766026704640_Ravenloft_CotC_8k_Night_Grid_50x40_163PPI.jpg" | "/maps/uploads/1766027650964_Ravenloft_CotC_8k_Night_Grid_50x40_163PPI.jpg" | "/robots.txt" | "/tokens/goblin.png" | "/tokens/player.png" | "/tokens/uploads/1764822382905_vampire1.png" | "/tokens/uploads/1764822791816_vampire1.png" | string & {};
	}
}