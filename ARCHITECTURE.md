# ISP Network ERP Architecture Specification

## 1. System Architecture
The application follows a clean 3-tier architecture with modular domain services:

```
                  ┌──────────────────────────────────────────────┐
                  │          React + TypeScript Frontend         │
                  │   (Vite, Tailwind CSS, shadcn/ui, TanStack) │
                  └──────────────────────┬───────────────────────┘
                                         │ REST API & WebSockets
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │                 Go Echo API                  │
                  │  ┌────────────────────────────────────────┐  │
                  │  │ Auth & RBAC Middleware                 │  │
                  │  ├────────────────────────────────────────┤  │
                  │  │ Inventory & Stock Transaction Engine   │  │
                  │  ├────────────────────────────────────────┤  │
                  │  │ Requisitions, Tasks & Tickets Engine   │  │
                  │  ├────────────────────────────────────────┤  │
                  │  │ Customers, Hotspots & Voucher Service │  │
                  │  ├────────────────────────────────────────┤  │
                  │  │ Network Topology & GIS Engine          │  │
                  │  ├────────────────────────────────────────┤  │
                  │  │ GenieACS TR-069 Service Client         │  │
                  │  ├────────────────────────────────────────┤  │
                  │  │ Procurement, Projects & Audit Engine   │  │
                  │  └────────────────────────────────────────┘  │
                  └──────────────────────┬───────────────────────┘
                                         │
                   ┌─────────────────────┼─────────────────────┐
                   ▼                     ▼                     ▼
        ┌────────────────────┐  ┌──────────────────┐  ┌─────────────────┐
        │ PostgreSQL Database│  │   GenieACS API   │  │ FreeRADIUS / NAS│
        │ System of Record   │  │ TR-069 Management│  │ Access Control  │
        └────────────────────┘  └──────────────────┘  └─────────────────┘
```

## 2. Database Model
Key relational entities in PostgreSQL:
- **`users`**, **`roles`**, **`permissions`**, **`user_roles`**, **`audit_ledger`**
- **`item_catalog`** (SKU, Asset Type [BULK, NONSER, ONT, RTR, NET, FAT], Unit Cost, Scope)
- **`serialized_inventory`** (Asset ID, SKU, S/N, MAC, Model, Condition, Status, Current Location, Custodian, Customer ID)
- **`bulk_inventory`** (SKU, Quantity, Unit, Reorder Level, Location)
- **`inventory_transactions`** (Immutable transaction ledger for Stock In/Out/Transfer/Issue/Replacement)
- **`technician_requisitions`** & **`technician_tasks`**
- **`customer_tickets`** & **`device_replacements`**
- **`customers`** (Account No, Name, Subscription Type [PPPoE, Hotspot], Plot Number, Location, Contact Person, Assigned ONU/AP ID)
- **`hotspot_users`** & **`vouchers`** (Code, Duration, Max Devices, Status, Customer/Hotspot ID)
- **`olts`**, **`pon_ports`**, **`splitters`**, **`enclosures`** (FAT), **`aps`**, **`hotspots`**, **`fiber_routes`**
- **`genieacs_devices`** (Device ID, Serial, MAC, Optical Power, IP, CWMP Parameters Cache, Last Inform)
- **`projects`**, **`procurement_requests`**, **`delivery_notes`**

## 3. Core Domain Engines

### 3.1 Inventory & Movement Engine
- Every change in physical stock or location requires an atomic PostgreSQL transaction.
- Serialized devices cannot be in two locations or assigned to two active customers simultaneously.
- Stock issue requires state checks, reservation checks, and atomic debit/credit in the ledger.

### 3.2 Network Topology & GIS Engine
- Tree hierarchy navigation: `OLT` -> `PON Port` -> `Splitter` -> `FAT / Enclosure` -> `ONU / ONT` -> `Customer`.
- Customer Path Tracer: Traces the exact physical and logical path from Customer to Core NOC Router.
- Wireless Topology: `Hotspot Area` -> `Access Points` -> `Active Wireless Clients`.

### 3.3 GenieACS Integration
- Server-side proxy calls GenieACS REST API using internal service credentials.
- Periodically caches device metrics (Optical RX/TX power, WAN IP, uptime, connection state).
- On-demand control commands (Refresh, Reboot, Factory Reset, Firmware Update) are logged to `genieacs_audit_logs`.

### 3.4 BSS / RADIUS Management Engine
- ERP acts as BSS system of record for Hotspot accounts, PPPoE credentials, and vouchers.
- Changes trigger events that sync credentials to FreeRADIUS (`radcheck`, `radreply`).
