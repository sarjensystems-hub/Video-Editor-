import type { CreativeUiFrame, CreativeUiLayout, CreativeUiNode } from "./schema";

function constrainedFrame(parent: { width: number; height: number }, node: CreativeUiNode): CreativeUiFrame {
  const frame = { ...node.frame };
  const constraints = node.constraints;
  if (!constraints) return frame;
  if (constraints.left !== undefined) frame.x = constraints.left;
  if (constraints.right !== undefined) constraints.left !== undefined ? frame.width = Math.max(0, parent.width - constraints.left - constraints.right) : frame.x = parent.width - constraints.right - frame.width;
  if (constraints.top !== undefined) frame.y = constraints.top;
  if (constraints.bottom !== undefined) constraints.top !== undefined ? frame.height = Math.max(0, parent.height - constraints.top - constraints.bottom) : frame.y = parent.height - constraints.bottom - frame.height;
  if (constraints.horizontal === "start") frame.x = constraints.left ?? 0;
  if (constraints.horizontal === "center") frame.x = (parent.width - frame.width) / 2;
  if (constraints.horizontal === "end") frame.x = parent.width - (constraints.right ?? 0) - frame.width;
  if (constraints.horizontal === "stretch") { frame.x = constraints.left ?? 0; frame.width = Math.max(0, parent.width - frame.x - (constraints.right ?? 0)); }
  if (constraints.vertical === "start") frame.y = constraints.top ?? 0;
  if (constraints.vertical === "center") frame.y = (parent.height - frame.height) / 2;
  if (constraints.vertical === "end") frame.y = parent.height - (constraints.bottom ?? 0) - frame.height;
  if (constraints.vertical === "stretch") { frame.y = constraints.top ?? 0; frame.height = Math.max(0, parent.height - frame.y - (constraints.bottom ?? 0)); }
  return frame;
}

export function resolveUiChildFrames(parent: { width: number; height: number }, nodes: CreativeUiNode[], layout?: CreativeUiLayout): CreativeUiFrame[] {
  if (!layout) return nodes.map((node) => constrainedFrame(parent, node));
  const padding = Math.max(0, layout.padding ?? 0);
  const gap = Math.max(0, layout.gap ?? 0);
  if (layout.mode === "grid") {
    const columns = Math.max(1, Math.round(layout.columns));
    const cellWidth = Math.max(0, (parent.width - padding * 2 - gap * (columns - 1)) / columns);
    const rowHeight = Math.max(0, layout.rowHeight ?? Math.max(0, ...nodes.map((node) => node.frame.height)));
    let column = 0; let row = 0;
    return nodes.map((node) => {
      const span = Math.max(1, Math.min(columns, Math.round(node.layoutItem?.columnSpan ?? 1)));
      if (column + span > columns) { row += 1; column = 0; }
      const authoredHeight = node.frame.height;
      const align = node.layoutItem?.alignSelf ?? "stretch";
      const height = align === "stretch" ? rowHeight : Math.min(rowHeight, authoredHeight);
      const rowY = padding + row * (rowHeight + gap);
      const y = align === "center" ? rowY + (rowHeight - height) / 2 : align === "end" ? rowY + rowHeight - height : rowY;
      const frame = { x: padding + column * (cellWidth + gap), y, width: cellWidth * span + gap * (span - 1), height };
      column += span; if (column >= columns) { row += 1; column = 0; }
      return frame;
    });
  }
  const row = (layout.direction ?? "row") === "row";
  const mainSize = row ? parent.width : parent.height;
  const crossSize = row ? parent.height : parent.width;
  const available = Math.max(0, mainSize - padding * 2 - gap * Math.max(0, nodes.length - 1));
  const bases = nodes.map((node) => row ? node.frame.width : node.frame.height);
  const growth = nodes.map((node) => Math.max(0, node.layoutItem?.grow ?? 0));
  const free = Math.max(0, available - bases.reduce((sum, value) => sum + value, 0));
  const totalGrowth = growth.reduce((sum, value) => sum + value, 0);
  const sizes = bases.map((base, index) => base + (totalGrowth ? free * growth[index] / totalGrowth : 0));
  const used = sizes.reduce((sum, value) => sum + value, 0) + gap * Math.max(0, nodes.length - 1);
  const justifyOffset = layout.justify === "center" ? (mainSize - padding * 2 - used) / 2 : layout.justify === "end" ? mainSize - padding * 2 - used : 0;
  let cursor = padding + Math.max(0, justifyOffset);
  return nodes.map((node, index) => {
    const authoredCross = row ? node.frame.height : node.frame.width;
    const align = node.layoutItem?.alignSelf ?? layout.align ?? "start";
    const cross = align === "stretch" ? Math.max(0, crossSize - padding * 2) : authoredCross;
    const crossAt = align === "center" ? (crossSize - cross) / 2 : align === "end" ? crossSize - padding - cross : padding;
    const frame = row ? { x: cursor, y: crossAt, width: sizes[index], height: cross } : { x: crossAt, y: cursor, width: cross, height: sizes[index] };
    cursor += sizes[index] + gap;
    return frame;
  });
}
