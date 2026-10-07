// Browser preview of the graph UI without Obsidian: `npm run preview`, then open dev/out/preview.html.
// Uses the same core + React components as the plugin; Obsidian services are replaced by console logs.

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
		onOpen={(location) => console.log("open", location)}
		onPositionsChange={(changed) => console.log("positions", changed)}
		onResetLayout={() => console.log("reset layout")}
		onConnect={(source, target) => console.log("connect", source, target)}
		onConnectToNew={(source, drop) => console.log("connect to new", source, drop)}
		onNodeMenu={(_e, id) => console.log("node menu", id)}
		onPaneMenu={(_e, position) => console.log("pane menu", position)}
		onEdgeMenu={(_e, ids) => console.log("edge menu", ids)}
		onSelectionChange={(selection) => console.log("selection", selection)}
		onRenameNode={(id) => console.log("rename", id)}
		onDeleteNode={(id) => console.log("delete node", id)}
		onDeleteLinks={(ids) => console.log("delete links", ids)}
		sourceLine={(location) => sources.get(location.file)?.split("\n")[location.line - 1] ?? null}
	/>,
);
