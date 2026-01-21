# APPENDIX D: FEATURE DEPENDENCY GRAPH (v3)

**Parent Document:** [Big Picture Master Plan v3](../BIG_PICTURE_MASTER_PLAN_v1_ANTIGRAVITY.md)
**Scope:** Visual dependency mapping and Critical Path Analysis.

---

## 1. Critical Path Analysis

The project success relies on a strict sequence. We cannot build "Combat" before "Locomotion" because Combat relies on positioning.

**The Golden Path:**
1.  **SimCore (Kernel)** - The brain.
2.  **Transport** - The nervous system.
3.  **Locomotion** - The legs.
4.  **Perception** - The eyes.
5.  **Interaction** - The hands (Mining/Shooting).

---

## 2. Dependency Graph (Mermaid)

```mermaid
graph TD
    %% Nodes
    subgraph Kernel
        Sim[SimCore Loop]
        State[State Registry]
        RNG[Seeded RNG]
    end

    subgraph Net
        Trans[ITransport]
        Lobby[Lobby/Signaling]
        Pred[Client Prediction]
    end

    subgraph PHY[Locomotion Features]
        Roll[F01: MOVE_ROLL]
        Slope[Slope Constraints]
        Mass[Inertia/Mass]
    end

    subgraph VIS[Vision Features]
        Opt[F03: OPTICAL_VIS]
        Scan[F04: SUBSURFACE]
        FOW[Fog of War]
    end

    subgraph ECO[Economy Features]
        Mine[F05: MINING]
        Haul[F06: TRANSPORT]
        Shape[F07: SHAPING]
    end

    subgraph WAR[Combat Features]
        Shoot[F02: SHOOT]
        Dmg[Damage System]
    end
    
    subgraph PIPELINE[R&D Pipeline]
        Goal[Goal Evaluator]
        Res[Research Mgr]
        Des[Designer UI]
        Prod[Factory]
    end

    %% Edges - Core dependencies
    Sim --> State
    State --> RNG
    Sim --> Trans
    
    %% Edges - Physics
    Sim --> Roll
    Roll --> Slope
    Roll --> Mass
    
    %% Edges - Vision dependent on Position
    Roll --> Opt
    Opt --> FOW
    Roll --> Scan
    
    %% Edges - Interaction dependent on Vision + Pos
    Opt --> Shoot
    Shoot --> Dmg
    
    Scan --> Mine
    Mine --> Haul
    Haul --> Shape
    
    %% The Pipeline Wraps Everything
    Res --> Roll
    Des --> Roll
    Prod --> Roll
    
    %% Styles
    classDef core fill:#f9f,stroke:#333;
    classDef feat fill:#bbf,stroke:#333;
    class Sim,State,RNG,Trans core;
    class Roll,Opt,Shoot,Mine feat;
```

---

## 3. Module Interaction Matrix

| Module | Needed By | Provides |
| :--- | :--- | :--- |
| **Locomotion** | Combat, Mining, Transport | `Position`, `Velocity` |
| **Vision** | Combat, Mining | `VisibleEntities[]` |
| **Inventory** | Transport, Mining | `CargoCapacity`, `MassModifier` |
| **Stats** | Locomotion, Combat | `Speed`, `Range`, `Damage` |

---
*End of Appendix*
