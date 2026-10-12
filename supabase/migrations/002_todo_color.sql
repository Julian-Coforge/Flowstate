alter table public.todos
  add column if not exists color text not null default 'none';
