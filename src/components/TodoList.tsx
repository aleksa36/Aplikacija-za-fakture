import { useEffect, useState } from 'react';
import { ActionIcon, Checkbox, Collapse, Group, Stack, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconPlus, IconTrash } from '@tabler/icons-react';
import type { Todo } from '../../shared/types.ts';
import { formatDate } from '../../shared/format.ts';
import { useDeleteTodo, useSaveTodo, useTodos } from '../api.ts';
import { ClientBadge } from './common.tsx';

function TodoRow({ todo, showClient }: { todo: Todo; showClient?: boolean }) {
  const save = useSaveTodo();
  const del = useDeleteTodo();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(todo.text);
  // Štikliranje se prikazuje odmah, bez čekanja servera.
  const [done, setDone] = useState(todo.done);
  useEffect(() => setDone(todo.done), [todo.done]);

  const commit = () => {
    setEditing(false);
    if (text.trim() && text.trim() !== todo.text) save.mutate({ id: todo.id, text: text.trim() });
    else setText(todo.text);
  };

  return (
    <Group gap="xs" wrap="nowrap" align="flex-start" className="todo-row">
      <Checkbox
        mt={3}
        checked={done}
        onChange={(e) => {
          const next = e.currentTarget.checked;
          setDone(next);
          save.mutate({ id: todo.id, done: next }, { onError: () => setDone(!next) });
        }}
        aria-label={done ? 'Vrati kao nezavršeno' : 'Označi kao završeno'}
      />
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <TextInput
            size="xs"
            value={text}
            autoFocus
            onChange={(e) => setText(e.currentTarget.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setText(todo.text);
                setEditing(false);
              }
            }}
          />
        ) : (
          <Text
            size="sm"
            td={todo.done ? 'line-through' : undefined}
            c={todo.done ? 'dimmed' : undefined}
            style={{ cursor: 'text', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            onClick={() => setEditing(true)}
          >
            {todo.text}
          </Text>
        )}
        {showClient && <ClientBadge name={todo.clientName} color={todo.clientColor} />}
        {todo.done && todo.doneAt && (
          <Text size="xs" c="dimmed">
            završeno {formatDate(todo.doneAt.slice(0, 10))}
          </Text>
        )}
      </Stack>
      <Tooltip label="Obriši">
        <ActionIcon variant="subtle" color="red" size="sm" onClick={() => del.mutate(todo.id)} aria-label="Obriši zadatak">
          <IconTrash size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

/** Todo lista za jednog klijenta: dodavanje, štikliranje, izmena (klik na tekst) i brisanje. */
export function TodoList({ clientId }: { clientId: number }) {
  const todos = useTodos({ clientId });
  const save = useSaveTodo();
  const [text, setText] = useState('');
  const [showDone, setShowDone] = useState(false);

  const open = (todos.data ?? []).filter((t) => !t.done);
  const done = (todos.data ?? []).filter((t) => t.done);

  const add = () => {
    if (!text.trim()) return;
    save.mutate({ clientId, text: text.trim() }, { onSuccess: () => setText('') });
  };

  return (
    <Stack gap="sm">
      <TextInput
        placeholder="Šta treba uraditi… (Enter)"
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        rightSection={
          <ActionIcon variant="filled" size="sm" onClick={add} disabled={!text.trim()} loading={save.isPending} aria-label="Dodaj zadatak">
            <IconPlus size={14} />
          </ActionIcon>
        }
      />
      {open.length === 0 && !todos.isLoading && (
        <Text size="sm" c="dimmed">
          Nema otvorenih zadataka.
        </Text>
      )}
      {open.map((t) => (
        <TodoRow key={t.id} todo={t} />
      ))}
      {done.length > 0 && (
        <>
          <UnstyledButton onClick={() => setShowDone((v) => !v)}>
            <Group gap={4}>
              {showDone ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
              <Text size="sm" c="dimmed">
                Završeno ({done.length})
              </Text>
            </Group>
          </UnstyledButton>
          <Collapse in={showDone}>
            <Stack gap="sm">
              {done.map((t) => (
                <TodoRow key={t.id} todo={t} />
              ))}
            </Stack>
          </Collapse>
        </>
      )}
    </Stack>
  );
}

export { TodoRow };
