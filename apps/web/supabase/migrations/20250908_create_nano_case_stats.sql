-- Create table for nano case selection statistics
create table if not exists public.nano_case_stats (
  id uuid default gen_random_uuid() primary key,
  case_id text not null,
  user_id uuid references auth.users(id) on delete cascade,
  selected_at timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

-- Create index for better query performance
create index if not exists nano_case_stats_case_id_idx on public.nano_case_stats(case_id);
create index if not exists nano_case_stats_selected_at_idx on public.nano_case_stats(selected_at);
create index if not exists nano_case_stats_user_id_idx on public.nano_case_stats(user_id);

-- Enable RLS
alter table public.nano_case_stats enable row level security;

-- Create policies
create policy "Users can insert their own case stats" on public.nano_case_stats
  for insert with check (auth.uid() = user_id);

create policy "Users can view their own case stats" on public.nano_case_stats
  for select using (auth.uid() = user_id);

-- Allow admins to view all stats (optional)
create policy "Admins can view all case stats" on public.nano_case_stats
  for select using (
    exists (
      select 1 from public.users 
      where id = auth.uid() and role = 'admin'
    )
  );
