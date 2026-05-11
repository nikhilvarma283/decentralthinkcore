package decentralthink.agent

import future.keywords.if
import future.keywords.in
import future.keywords.contains

default allow = false

# Allow if session is valid and task is not blocked
allow if {
  valid_session
  not blocked_task
}

valid_session if {
  input.session.wallet_address != ""
  input.session.expires_at > time.now_ns() / 1000000000
}

blocked_task if {
  blocked_patterns := ["rm -rf", "DROP TABLE", "shutdown", "exec("]
  some pattern in blocked_patterns
  contains(lower(input.task), lower(pattern))
}

# Deny reasons for observability
deny_reasons contains reason if {
  not valid_session
  reason := "invalid or expired session"
}

deny_reasons contains reason if {
  blocked_task
  reason := "task contains blocked pattern"
}
