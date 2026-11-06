"use client";

import { Unplug } from "lucide-react";
import { Button } from "@/components/ui";
import { disconnectInstagramConnection } from "@/features/settings/actions";

export function DisconnectAccountButton({ connectionId, username }: { connectionId: string; username: string }) {
  return (
    <form
      action={disconnectInstagramConnection}
      onSubmit={(event) => {
        if (!window.confirm(`Desconectar @${username}? As automações desta conta param de responder até você reautorizar. A outra conta permanece intacta.`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="connectionId" value={connectionId} />
      <Button variant="danger" type="submit"><Unplug size={15} /> Desconectar</Button>
    </form>
  );
}
