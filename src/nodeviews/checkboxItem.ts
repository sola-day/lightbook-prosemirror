import { Node as PMNode } from "prosemirror-model";
import { EditorView, NodeView, ViewMutationRecord } from "prosemirror-view";

/**
 * `toDOM` alone can render a checkbox's checked state but can't wire up a
 * click handler, so without a NodeView the checkbox is decorative only and
 * can never actually be toggled by the user. This NodeView renders a real
 * `<input type="checkbox">` and flips `attrs.checked` via a transaction on
 * click, while leaving the rest of the list item's content editable as
 * normal ProseMirror-managed DOM.
 */
export class CheckboxItemView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private checkbox: HTMLInputElement;
  private node: PMNode;
  private view: EditorView;
  private getPos: () => number | undefined;

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    this.dom = document.createElement("li");
    this.dom.setAttribute("data-checked", String(!!node.attrs.checked));

    this.checkbox = document.createElement("input");
    this.checkbox.type = "checkbox";
    this.checkbox.contentEditable = "false";
    this.checkbox.checked = !!node.attrs.checked;
    this.checkbox.addEventListener("mousedown", (e) => e.preventDefault());
    this.checkbox.addEventListener("change", () => this.toggle());
    this.dom.appendChild(this.checkbox);

    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "lb-checkbox-content";
    this.dom.appendChild(this.contentDOM);
  }

  private toggle() {
    const pos = this.getPos();
    if (pos === undefined) return;
    const tr = this.view.state.tr.setNodeAttribute(pos, "checked", !this.node.attrs.checked);
    this.view.dispatch(tr);
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.checkbox.checked = !!node.attrs.checked;
    this.dom.setAttribute("data-checked", String(!!node.attrs.checked));
    return true;
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    return mutation.target === this.checkbox;
  }
}
