# R013 M07 - Manual Test Scenarios
> Status: PENDING - These scenarios need manual testing in 2 browser tabs.

## Pre-requisites
- Run with `?net=supabase` URL parameter
- Two browser tabs (Tab A = Host, Tab B = Guest)
- Open browser DevTools console in both tabs

---

## TS-01: JoinOverlay Single-Screen Flow

### Host Side (Tab A)
1. Page loads → JoinOverlay visible with "ASTEROBIA / MULTIPLAYER"
2. Username input editable (type "TestHost") ✓/✗
3. Click HOST GAME → button transforms to room code (2 digits, green glow)
4. JOIN GAME button transforms to START GAME
5. Player count shows "Players: 1"
6. Room code visible and readable

### Guest Side (Tab B)
7. Type "TestGuest" in username field
8. Click JOIN GAME → button row transforms to [Room: __] + [JOIN →]
9. Enter the room code from Tab A
10. Click JOIN → overlay hides, game visible
11. Tab A shows "Players: 2" (count updated)

### Host Start
12. Tab A: Click START GAME → overlay hides, game visible
13. Both tabs show the game world

**Expected**: Single-screen, no page transitions. Smooth in-place button transformations.

---

## TS-02: MultiplayerHUD (Top-Right)

1. After join, Tab A (Host) shows HUD: "♛ Host: TestHost / ● Online / Players: 2 / Room: XX"
2. Tab B (Guest) shows same info
3. Player count updates when players join/leave
4. Room code matches what was shown in JoinOverlay
5. HUD is non-interactive (doesn't block game clicks)

---

## TS-03: Console Toggle (Top-Left)

1. Top-left corner has "Console" button
2. Click → all debug panels appear (Network panel, Tweakpane, Stats.js)
3. Click again → all panels hide
4. Default state: hidden (panels not visible on game start)
5. NetworkDebugPanel shows unified content (Role, NET, AUTH, RT, Batch stats, Save/Load)

---

## TS-04: Host-Guest Ownership Flow

### Host Selects Unit
1. Tab A: Click a unit → unit selected (green ring), tab appears
2. Tab B: Same unit shows OCCUPIED indicator with "TestHost" name
3. Tab A: Press ESC → unit deselected, but stays in Host's tab (ownerSlot persists)
4. Tab B: OCCUPIED indicator disappears (unit is free)

### Guest Enters via PIN
5. Tab B: Click a PIN-protected unit → keypad appears
6. Enter correct PIN digit → unit selected, tab appears for Guest
7. Tab A: Unit shows OCCUPIED by "TestGuest"
8. Tab B: Press ESC → unit stays in Guest's tab (ownership persists)

### Ownership Transfer
9. Tab A: Click unit that Guest owns → OCCUPIED feedback (can't enter)
10. Tab B: Click unit → re-enters without PIN (owner bypass)

---

## TS-05: Host Leave + Migration

1. Both tabs in game
2. Tab A (Host): Close tab or navigate away
3. Tab B: After ~3-5 seconds, Guest promotes to Host
4. Tab B: MultiplayerHUD updates to show Guest as new Host
5. Open Tab C: Can join with room code (new Host accepts)
6. Tab B + Tab C: Game continues with 2 players

---

## TS-06: Slice 2 - Command Execution

1. Both tabs in game, both seated in different units
2. Tab A: Draw a path on Host's unit → unit starts moving
3. Tab B: Sees the same unit moving (command executed on Guest)
4. Tab B: Draw a path on Guest's unit → unit starts moving
5. Tab A: Sees Guest's unit moving
6. Console (dev mode): Check stateHash logs - should show periodic hashes

---

## TS-07: Indicator Planet Occlusion

1. Select a unit on the visible side → green indicator above it
2. Rotate camera to the far side of planet
3. The unit's indicator should NOT be visible through the planet
4. Rotate back → indicator visible again

---

## TS-08: SeatKeypadOverlay

1. Click a PIN-protected unit → keypad appears
2. Press ESC → keypad closes
3. Click X button → keypad closes
4. While keypad visible: keyboard input blocked from reaching game
5. Enter wrong PIN → rejection feedback
6. Enter correct PIN → unit selected, keypad closes

---

## TS-09: Player Count & Display Names

1. JoinOverlay: Player count updates live as guests join
2. MultiplayerHUD: Shows correct count (Host + Guests)
3. OCCUPIED indicators: Show actual player names (not "Host"/"Player 1")
4. HOST_ANNOUNCE: Contains hostDisplayName (check console)

---

## TS-10: Edge Cases

1. Guest disconnects → Host's player count decreases
2. Two guests try to enter same unit → second sees OCCUPIED
3. Host and Guest both try to select same unit simultaneously → only one succeeds
4. Rapid HOST/JOIN clicks → no crashes
5. Empty username → defaults to "Host"/"Guest"
6. Invalid room code (1, 100, abc) → error message shown

---

## Automation Status
| Scenario | Automated Tests | Manual Only |
|----------|----------------|-------------|
| TS-01 JoinOverlay | - | Manual |
| TS-02 MultiplayerHUD | - | Manual |
| TS-03 Console Toggle | - | Manual |
| TS-04 Ownership Flow | 8 seat tests | Partial |
| TS-05 Host Leave | 29 tests | Migration visual |
| TS-06 Slice 2 Execution | r010-determinism | Network sync |
| TS-07 Indicator Occlusion | - | Visual only |
| TS-08 Keypad | 8 seat tests | UX flow |
| TS-09 Player Count | 3 join tests | Display |
| TS-10 Edge Cases | - | Manual |
