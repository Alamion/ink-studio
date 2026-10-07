// Browser preview of the graph UI without Obsidian: `npm run preview`, then open dev/out/preview.html.
// Uses the same core + React components as the plugin; Obsidian services are replaced by no-ops.

import "@xyflow/react/dist/style.css";
import "../src/ui/styles.css";
import "./preview.css";

import { createRoot } from "react-dom/client";
import { buildStoryGraph } from "@ink-studio/core";
import { DEFAULT_SETTINGS } from "../src/settings";
import { GraphApp } from "../src/ui/GraphApp";

declare const __PREVIEW__: { root: string; sources: Record<string, string>; theme: "light" | "dark" };

const sources = new Map(Object.entries(__PREVIEW__.sources));
const graph = buildStoryGraph(__PREVIEW__.root, sources);
const container = document.getElementById("app")!;
container.classList.add("ink-graph-view");
document.body.classList.add(`theme-${__PREVIEW__.theme}`);

createRoot(container).render(
	<GraphApp
		graph={graph}
		settings={DEFAULT_SETTINGS}
		positions={{}}
		colorMode={__PREVIEW__.theme}
		onOpen={(location) => undefined}
		onPositionsChange={(changed) => undefined}
		onResetLayout={() => undefined}
		onConnect={(source, target) => undefined}
		onConnectToNew={(source, drop) => undefined}
		onNodeMenu={(_e, id) => undefined}
		onPaneMenu={(_e, position) => undefined}
		onEdgeMenu={(_e, ids) => undefined}
		onSelectionChange={(selection) => undefined}
		onRenameNode={(id) => undefined}
		onDeleteNode={(id) => undefined}
		onDeleteLinks={(ids) => undefined}
		sourceLine={(location) => sources.get(location.file)?.split("\n")[location.line - 1] ?? null}
	/>,
);
