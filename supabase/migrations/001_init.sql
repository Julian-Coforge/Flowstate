-- Flowstate domain tables. Auth lives in auth.users (Supabase Auth).

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'active',
  created_at bigint not null
);

create table if not exists public.nodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  description text not null default '',
  importance text not null default 'medium',
  notes text not null default '',
  status text not null default 'todo',
  x double precision not null default 0,
  y double precision not null default 0
);

create table if not exists public.edges (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  source_node_id uuid not null references public.nodes (id) on delete cascade,
  target_node_id uuid not null references public.nodes (id) on delete cascade,
  constraint edges_unique unique (project_id, source_node_id, target_node_id)
);

create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes (id) on delete cascade,
  text text not null,
  done boolean not null default false,
  position integer not null default 0
);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  node_id uuid references public.nodes (id) on delete set null,
  text text not null,
  done boolean not null default false,
  due_date date,
  recurrence text not null default 'none'
);

create index if not exists projects_user on public.projects (user_id);
create index if not exists nodes_project on public.nodes (project_id);
create index if not exists todos_user on public.todos (user_id);

alter table public.projects enable row level security;
alter table public.nodes enable row level security;
alter table public.edges enable row level security;
alter table public.checklist_items enable row level security;
alter table public.todos enable row level security;

drop policy if exists projects_own on public.projects;
create policy projects_own on public.projects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists nodes_own on public.nodes;
create policy nodes_own on public.nodes
  for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

drop policy if exists edges_own on public.edges;
create policy edges_own on public.edges
  for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

drop policy if exists checklist_own on public.checklist_items;
create policy checklist_own on public.checklist_items
  for all using (
    exists (
      select 1 from public.nodes n
      join public.projects p on p.id = n.project_id
      where n.id = node_id and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.nodes n
      join public.projects p on p.id = n.project_id
      where n.id = node_id and p.user_id = auth.uid()
    )
  );

drop policy if exists todos_own on public.todos;
create policy todos_own on public.todos
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
