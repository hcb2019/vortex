import Link from "next/link";
import { BarChart3, Bolt, BookOpenCheck, Clapperboard, History, PlusCircle, Radar, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { AccountSwitcher } from "@/features/settings/account-switcher";
import { isDemoMode } from "@/lib/env";
import type { InstagramConnection } from "@/types/domain";

const nav = [
  { href: "/dashboard", label: "Visão geral", icon: BarChart3 },
  { href: "/radar", label: "Radar", icon: Radar },
  { href: "/studio", label: "Estúdio", icon: Clapperboard },
  { href: "/novo-conteudo", label: "Novo conteúdo", icon: PlusCircle },
  { href: "/connection-guide", label: "Guia de conexão", icon: BookOpenCheck },
  { href: "/automations", label: "Automações", icon: Bolt },
  { href: "/history", label: "Histórico", icon: History },
  { href: "/settings", label: "Integração", icon: Settings2 },
];

export function AppShell({
  children,
  connections,
  selectedConnection,
}: {
  children: ReactNode;
  connections: InstagramConnection[];
  selectedConnection: InstagramConnection | null;
}) {
  return <div className="app-shell">
    <aside className="sidebar">
      <BrandLogo />
      <nav aria-label="Navegação principal">{nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href}><Icon size={18} /><span>{label}</span></Link>)}</nav>
      <div className="sidebar-foot"><AccountSwitcher connections={connections} selected={selectedConnection} /></div>
    </aside>
    <main className="main-content">{isDemoMode && <div className="demo-banner"><span>Modo demonstração</span><p>Dados simulados — nenhuma mensagem será enviada.</p></div>}{children}</main>
  </div>;
}
