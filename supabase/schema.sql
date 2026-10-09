-- Run in Supabase SQL Editor. Enable RLS and restrict all tables to authenticated users.
create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);
create table if not exists public.formats (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on update cascade on delete restrict,
  name text not null,
  has_next_station boolean not null default false,
  created_at timestamptz not null default now(),
  unique(company_id, name)
);
create table if not exists public.targets (
  id uuid primary key default gen_random_uuid(),
  format_id uuid not null references public.formats(id) on update cascade on delete restrict,
  category_id uuid not null references public.categories(id) on update cascade on delete restrict,
  destination text not null,
  record_type text not null default '定期' check (record_type in ('定期','定期外','消滅')),
  next_station boolean null,
  status text not null default '未撮影' check (status in ('済み','再履修','未撮影')),
  comment text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((record_type in ('定期','定期外','消滅'))),
  unique nulls not distinct (format_id, category_id, destination, record_type, next_station)
);
create table if not exists public.target_conditions (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.targets(id) on delete cascade,
  kind text not null check (kind in ('weekday','time')),
  value text not null,
  unique(target_id, kind, value)
);

create index if not exists targets_format_idx on public.targets(format_id);
create index if not exists targets_category_idx on public.targets(category_id);
create index if not exists targets_status_idx on public.targets(status);
create index if not exists targets_record_type_idx on public.targets(record_type);
create index if not exists target_conditions_kind_value_idx on public.target_conditions(kind, value);

-- Browser clients can read/write only after authentication. Do not enable anonymous access.
alter table public.companies enable row level security;
alter table public.categories enable row level security;
alter table public.formats enable row level security;
alter table public.targets enable row level security;
alter table public.target_conditions enable row level security;

drop policy if exists "authenticated full access companies" on public.companies;
create policy "authenticated full access companies" on public.companies for all to authenticated using (true) with check (true);
drop policy if exists "authenticated full access categories" on public.categories;
create policy "authenticated full access categories" on public.categories for all to authenticated using (true) with check (true);
drop policy if exists "authenticated full access formats" on public.formats;
create policy "authenticated full access formats" on public.formats for all to authenticated using (true) with check (true);
drop policy if exists "authenticated full access targets" on public.targets;
create policy "authenticated full access targets" on public.targets for all to authenticated using (true) with check (true);
drop policy if exists "authenticated full access target conditions" on public.target_conditions;
create policy "authenticated full access target conditions" on public.target_conditions for all to authenticated using (true) with check (true);

-- The schema uses Supabase Auth users. Disable public sign-ups in Supabase Auth settings
-- and create/invite only the family account(s) you intend to authorize.
