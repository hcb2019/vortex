"use client";

import { AtSign, ChevronDown } from "lucide-react";
import { selectInstagramConnection } from "@/features/settings/actions";
import type { InstagramConnection } from "@/types/domain";

export function AccountSwitcher({
  connections,
  selected,
}: {
  connections: InstagramConnection[];
  selected: InstagramConnection | null;
}) {
  const live = connections.filter((item) => item.status !== "disconnected");
  const current = selected ?? live[0] ?? null;

  if (!current) {
    return <>
      <div className="account-avatar"><AtSign size={16} /></div>
      <div><strong>Instagram</strong><span>Nenhuma conta conectada</span></div>
    </>;
  }

  if (live.length < 2) {
    return <>
      <div className="account-avatar"><AtSign size={16} /></div>
      <div><strong>@{current.username}</strong><span>Conta selecionada</span></div>
    </>;
  }

  return <>
    <div className="account-avatar"><AtSign size={16} /></div>
    <form className="account-switcher" action={selectInstagramConnection}>
      <label className="sr-only" htmlFor="account-switcher">Conta do Instagram</label>
      <select
        id="account-switcher"
        name="connectionId"
        defaultValue={current.id}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {live.map((item) => <option key={item.id} value={item.id}>@{item.username}</option>)}
      </select>
      <ChevronDown size={14} />
      <span>Trocar conta do painel</span>
    </form>
  </>;
}
