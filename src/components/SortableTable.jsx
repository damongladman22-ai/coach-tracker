import { useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase } from '../lib/supabase'

/**
 * Touch-aware sortable table wrapper.
 *
 * Usage:
 *   <SortableTable
 *     items={items}
 *     setItems={setItems}
 *     tableName="programs"
 *     headerCols={['Name', 'Status', '']}
 *     renderRow={(item) => (
 *       <>
 *         <td>{item.name}</td>
 *         <td>...</td>
 *         <td>actions</td>
 *       </>
 *     )}
 *   />
 *
 * - Activation requires either pointer drag (mouse) or a 200ms hold (touch),
 *   so taps and scrolls aren't accidentally treated as drag starts.
 * - Order is persisted to the named Supabase table by stamping sort_order
 *   to each row's new index.
 */
export default function SortableTable({
  items,
  setItems,
  tableName,
  headerCols,
  renderRow,
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const persistOrder = useCallback(
    async (newItems) => {
      const updates = newItems.map((item, idx) =>
        supabase
          .from(tableName)
          .update({ sort_order: idx })
          .eq('id', item.id)
      )
      const results = await Promise.all(updates)
      const failed = results.find((r) => r.error)
      if (failed) {
        console.error('Failed to persist order:', failed.error)
      }
    },
    [tableName]
  )

  const handleDragEnd = useCallback(
    (event) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIdx = items.findIndex((i) => i.id === active.id)
      const newIdx = items.findIndex((i) => i.id === over.id)
      if (oldIdx < 0 || newIdx < 0) return
      const newItems = arrayMove(items, oldIdx, newIdx).map((it, idx) => ({
        ...it,
        sort_order: idx,
      }))
      setItems(newItems)
      persistOrder(newItems)
    },
    [items, setItems, persistOrder]
  )

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="w-12"></th>
            {headerCols.map((col, idx) => (
              <th
                key={idx}
                className={`px-4 py-3 text-sm font-medium text-gray-500 ${
                  idx === headerCols.length - 1 ? 'text-right' : 'text-left'
                }`}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={items.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            <tbody className="divide-y divide-gray-200">
              {items.map((item) => (
                <SortableRow key={item.id} id={item.id} item={item}>
                  {renderRow(item)}
                </SortableRow>
              ))}
            </tbody>
          </SortableContext>
        </DndContext>
      </table>
    </div>
  )
}

function SortableRow({ id, item, children }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`${isDragging ? 'opacity-40 bg-blue-50' : ''} ${
        !item.active ? 'opacity-60' : ''
      }`}
    >
      <td className="w-12 text-center">
        <button
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className="text-gray-400 hover:text-gray-700 cursor-grab active:cursor-grabbing touch-none px-3 py-3 -mx-3 -my-3 select-none"
          type="button"
        >
          ⋮⋮
        </button>
      </td>
      {children}
    </tr>
  )
}
