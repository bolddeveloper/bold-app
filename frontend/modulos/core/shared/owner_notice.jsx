import "./owner_notice.css";

// Origin is asserted by the server, never inferred from a name, email or title.
export function OwnerNotice({notification}) {
    return notification?.actor_is_owner === true
        ? <span className="bold_owner_notice">Propietario</span> : null;
}
