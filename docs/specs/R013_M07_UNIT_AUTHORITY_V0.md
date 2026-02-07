# R013 M07 Unit Authority v0 (Canonical Spec)

**Status:** CANONICAL
**Version:** v0 (Slice 1)
**Date:** 2026-02-07

## 1. Data Model (Unit.js)

| Field | Type | Description |
|-------|------|-------------|
| **`ownerSlot`** | `number` | Economic owner. Defaults to spawner slot. Changes *only* on successful takeover. |
| **`selectedBySlot`** | `number \| null` | The driver. Exclusive - only one driver per unit. `null` = empty seat. |
| **`seatPolicy`** | `'OPEN' \| 'PIN_1DIGIT'` | Security level. |
| **`seatPinDigit`** | `number (1-9)` | The PIN code. **Host-only**. NEVER serialized to guests. |

## 2. Interaction Rules

### A. Selection & Driving (Gating)
- **Constraint**: A player can ONLY control (WASD, Path, Stop) a unit if `unit.selectedBySlot === mySlot`.
- **Ghost Driving Prevention**: If `selectedBySlot !== mySlot`, all input commands must be ignored by the simulation/game loop.
- **Selection UI**: Clicking a unit *without* authority should NOT select it immediately. It should trigger the **Seat Acquisition Flow**.

### B. Seat Acquisition Flow
Triggered when Guest clicks a unit they do not currently drive.

1.  **Check: Occupied?**
    -   If `unit.selectedBySlot !== null` AND `unit.selectedBySlot !== mySlot`:
    -   **Action**: Reject immediately. Show "OCCUPIED" feedback. Do NOT show Keypad.

2.  **Check: My Unit?**
    -   If `unit.ownerSlot === mySlot`:
    -   **Action**: Grant seat immediately (Auto-Pass). Send `SEAT_REQ`.

3.  **Check: Foreign Unit?**
    -   If `unit.ownerSlot !== mySlot`:
    -   **Case 'OPEN'**: Grant seat immediately. Send `SEAT_REQ`.
    -   **Case 'PIN_1DIGIT'**:
        -   **Action**: Show **Keypad Overlay**.
        -   User enters digit (1-9).
        -   Send `SEAT_REQ` with `{ auth: { guess: digit } }`.

### C. Host Validation (Server-Side)
The Host is the authority for `SEAT_REQ`.

1.  **Validate**: Is `unit.selectedBySlot` currently `null`? (Race condition check).
    -   If NO -> Send `SEAT_REJECT` (Reason: OCCUPIED).
2.  **Validate**: Auth.
    -   If 'OPEN' -> OK.
    -   If 'PIN_1DIGIT' -> Check `guess === unit.seatPinDigit`.
    -   If Match -> OK.
    -   If Mismatch -> Send `SEAT_REJECT` (Reason: WRONG_PIN) + Trigger Cooldown.

3.  **On Success**:
    -   Set `unit.selectedBySlot = requesterSlot`.
    -   (Optionally) Set `unit.ownerSlot = requesterSlot` (Takeover complete).
    -   Broadcast `SEAT_ACK`.

## 3. Visual Indicators (Guest Side)

- **Padlock Icon**: Visible if `policy='PIN'`, `seat=empty`, `owner != me`.
- **Person/Occupied Icon**: Visible if `seat != null` AND `seat != me`.
- **Green Glow**: Visible if `seat == me`.
