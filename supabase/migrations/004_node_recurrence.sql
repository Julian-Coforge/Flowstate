alter table public.nodes
  add column if not exists recurrence text not null default 'none';

alter table public.nodes
  drop constraint if exists nodes_recurrence_check;

alter table public.nodes
  add constraint nodes_recurrence_check
  check (recurrence in ('none', 'daily', 'weekly', 'monthly'));
