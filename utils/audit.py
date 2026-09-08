"""Helpers for recording species data history."""

from datetime import datetime
from uuid import uuid4

from flask import session

from models import AuditEvent

def record_audit_event(
    db,
    *,
    taxon_id,
    event_type,
    dataset_id=None,
    dataset_name=None,
    details=None,
):
    """Record an event in the audit trail."""
    actor_id = session.get('user_id') or 'local-user'
    actor_name = session.get('user_name') or actor_id

    event = AuditEvent(
        taxon_id=taxon_id,
        event_type=event_type,
        occurred_at=datetime.utcnow(),
        actor_id=actor_id,
        actor_name=actor_name,
        dataset_id=dataset_id,
        dataset_name=dataset_name,
        details=details or {},
    )
    db.add(event)
    return event