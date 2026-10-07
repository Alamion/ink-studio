// Tunables of the plugin in one place.

export const CONFIG = {
	viewType: "ink-graph-view",
	/** Not "git-fork": that is the core Graph view's icon, and two identical buttons in the ribbon are indistinguishable. */
	icon: "network",
	inkExtension: "ink",
	/** Sidecar next to the story root: `main.ink` → `main.graph.json` (commit it with the story). */
	layoutFileSuffix: ".graph.json",
	layoutFormatVersion: 1,
	rebuildDebounceMs: 400,
	layoutSaveDebounceMs: 800,
	choiceLabelMaxLength: 30,
	/** The side panel starts collapsed when the graph pane is narrower than this. */
	panelAutoCollapseBelowPx: 720,
	node: {
		width: 220,
		/** Title + file:line rows. */
		baseHeight: 52,
		/** One extra row per non-empty "reads" / "writes" line. */
		rowHeight: 18,
	},
	group: {
		/** Space above the first stitch reserved for the knot header. */
		headerHeight: 40,
		padding: 16,
	},
	edges: {
		/** Closer than this, an edge takes the detour instead of a curve through the nodes. */
		minForwardGap: 24,
		minCurvature: 40,
		detourGap: 18,
		detourMargin: 22,
		laneSpacing: 14,
		cornerRadius: 10,
		/**
		 * Where a detour's label sits along its corridor, from the source end (0) to the target end (1).
		 * Detours into the same node share corridors of similar length; their sources differ.
		 */
		detourLabelAt: 0.25,
		/** Choice lines shown in one edge label before collapsing into "+N". */
		maxLabelLines: 3,
	},
	elk: {
		"elk.algorithm": "layered",
		"elk.direction": "RIGHT",
		"elk.spacing.nodeNode": "48",
		// Wide gaps between columns leave room for choice labels on the edges.
		"elk.layered.spacing.nodeNodeBetweenLayers": "150",
		"elk.layered.spacing.edgeNodeBetweenLayers": "30",
		// Nodes arrive in story reading order: keep it, and treat edges against it as the "back" ones.
		"elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
		"elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
		"elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
	} as Record<string, string>,
} as const;
