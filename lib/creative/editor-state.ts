import type { CreativeDocument } from "./schema";
import {
  applyCreativeTransaction,
  type CreativeTransaction,
} from "./transactions";

export interface CreativeEditorSelection {
  sceneId: string;
  elementIds: string[];
}

export interface CreativeEditorState {
  document: CreativeDocument;
  savedDocument: CreativeDocument;
  past: CreativeDocument[];
  future: CreativeDocument[];
  selection: CreativeEditorSelection;
  dirty: boolean;
  lastError: string | null;
  lastSummary: string | null;
}

const MAX_HISTORY = 60;

function firstSelection(document: CreativeDocument): CreativeEditorSelection {
  const scene = document.scenes[0];
  return { sceneId: scene.id, elementIds: [] };
}

function normalizeSelection(
  document: CreativeDocument,
  selection: CreativeEditorSelection,
): CreativeEditorSelection {
  const scene = document.scenes.find((item) => item.id === selection.sceneId) ?? document.scenes[0];
  const available = new Set(scene.elements.map((element) => element.id));
  return {
    sceneId: scene.id,
    elementIds: selection.elementIds.filter((id) => available.has(id)),
  };
}

function withDocument(
  state: CreativeEditorState,
  document: CreativeDocument,
  patch: Partial<CreativeEditorState> = {},
): CreativeEditorState {
  return {
    ...state,
    ...patch,
    document,
    selection: normalizeSelection(document, patch.selection ?? state.selection),
    dirty: document !== state.savedDocument,
  };
}

export function createCreativeEditorState(document: CreativeDocument): CreativeEditorState {
  return {
    document,
    savedDocument: document,
    past: [],
    future: [],
    selection: firstSelection(document),
    dirty: false,
    lastError: null,
    lastSummary: null,
  };
}

export function setEditorSelection(
  state: CreativeEditorState,
  selection: CreativeEditorSelection,
): CreativeEditorState {
  return {
    ...state,
    selection: normalizeSelection(state.document, selection),
  };
}

export function applyEditorTransaction(
  state: CreativeEditorState,
  transaction: CreativeTransaction,
): CreativeEditorState {
  const result = applyCreativeTransaction(state.document, transaction);
  if (!result.ok) {
    return {
      ...state,
      lastError: result.error.message,
      lastSummary: null,
    };
  }
  const past = [...state.past, state.document].slice(-MAX_HISTORY);
  return withDocument(state, result.document, {
    past,
    future: [],
    lastError: null,
    lastSummary: result.summary,
  });
}

export function undoEditor(state: CreativeEditorState): CreativeEditorState {
  const previous = state.past[state.past.length - 1];
  if (!previous) return state;
  return withDocument(state, previous, {
    past: state.past.slice(0, -1),
    future: [state.document, ...state.future].slice(0, MAX_HISTORY),
    lastError: null,
    lastSummary: "Undo",
  });
}

export function redoEditor(state: CreativeEditorState): CreativeEditorState {
  const next = state.future[0];
  if (!next) return state;
  return withDocument(state, next, {
    past: [...state.past, state.document].slice(-MAX_HISTORY),
    future: state.future.slice(1),
    lastError: null,
    lastSummary: "Redo",
  });
}

export function markEditorSaved(state: CreativeEditorState): CreativeEditorState {
  return {
    ...state,
    savedDocument: state.document,
    dirty: false,
    lastError: null,
  };
}
