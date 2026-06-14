#!/bin/sh
# Nexus Control Center — package post-install hook (deb/rpm).
# Installs the scoped udev rule and creates the `nexus` group so RGB/fan control
# works WITHOUT adding the user to the broad `input` group (audit finding H4).
set -e

RULE_SRC="/usr/share/nexus-control-center/udev/99-nexus-omen.rules"
RULE_DST="/etc/udev/rules.d/99-nexus-omen.rules"

# 1. Dedicated, narrowly-scoped group.
groupadd -f nexus || true

# 2. Install the udev rule (idempotent).
if [ -f "$RULE_SRC" ]; then
  install -m 0644 "$RULE_SRC" "$RULE_DST"
fi

# 3. Reload + apply now if the device is already present.
if command -v udevadm >/dev/null 2>&1; then
  udevadm control --reload-rules || true
  udevadm trigger --subsystem-match=platform --attr-match=KERNEL=omen-rgb-keyboard || true
fi

cat <<'EOF'
─────────────────────────────────────────────────────────────
Nexus Control Center installed.

To enable RGB & fan control, add yourself to the scoped `nexus`
group (NOT the broad `input` group):

    sudo usermod -aG nexus "$USER"

Then log out and back in. Power profiles work with no extra step.
─────────────────────────────────────────────────────────────
EOF

exit 0
