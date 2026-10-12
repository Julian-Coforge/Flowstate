alter table public.nodes
  add column if not exists due_date date;

alter table public.edges
  add column if not exists source_handle text;

alter table public.edges
  add column if not exists target_handle text;
