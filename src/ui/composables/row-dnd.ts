import { ref } from 'vue';

export type DropWhere = 'before' | 'after';

/** HTML5 drag and drop reordering for list rows: before/after the hovered row, with a drop marker. */
export function useRowDnd(opts: {
  /** Ids that move when the drag starts on `id` (the row itself, or the whole selection). */
  dragIds: (id: string) => string[];
  onDrop: (ids: string[], targetId: string, where: DropWhere) => void;
}) {
  const mark = ref<{ id: string; where: DropWhere } | null>(null);
  let dragging: string[] | null = null;

  function end() {
    dragging = null;
    mark.value = null;
  }

  return {
    mark,
    dragging: () => dragging,
    start(e: DragEvent, id: string) {
      dragging = opts.dragIds(id);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
      }
    },
    over(e: DragEvent, id: string) {
      if (!dragging) return;
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const where: DropWhere = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
      if (mark.value?.id !== id || mark.value.where !== where) mark.value = { id, where };
    },
    drop(e: DragEvent, id: string) {
      e.preventDefault();
      if (dragging && mark.value) opts.onDrop(dragging, id, mark.value.where);
      end();
    },
    end,
  };
}
