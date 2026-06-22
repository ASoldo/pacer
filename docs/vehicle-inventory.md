# Vehicle Inventory and OBD Plan

## Profile Sources

- VIN decode creates the first vehicle profile from public manufacturer-reported fields.
- Owner edits are first-class because VIN decoders can miss trim, market, engine, and edition data.
- OBD confirmation should match the active profile by ECU-reported VIN when the vehicle supports standard Mode 09 PID 02.
- If the ECU does not expose a standard VIN, the app should fall back to a driver-selected garage profile plus adapter fingerprint.

## Data Layers

- Base profile: VIN, make, model, year, trim, chassis, generation, body, engine, fuel, drive, transmission, plant.
- Owner layer: modifications, wheels, brakes, suspension, tune, drivetrain changes, notes.
- Adapter layer: OBD adapter type, protocol preference, confirmed PIDs, ECU names, calibration IDs, calibration verification numbers.
- Session layer: live telemetry, DTCs, temperatures, speed, RPM, throttle, load, and timing data.

## Browser Boundary

- Web Bluetooth is usable for BLE OBD adapters that expose GATT services.
- Classic Bluetooth ELM327 adapters usually need a native bridge because browsers cannot open Bluetooth SPP directly.
- USB ELM327 adapters can use Web Serial on Chromium-based browsers with user permission.
- BMW/MINI-specific ECU data may require a native bridge, ENET, or a CAN/UDS stack beyond generic ELM327 commands.

## First Scrape Targets

- Standard OBD: VIN, supported PID bitmap, speed, RPM, throttle position, coolant temperature, intake temperature, fuel level, DTCs.
- Mode 09: calibration IDs, calibration verification numbers, ECU names where supported.
- BMW/MINI extension path: UDS VIN DID `F190`, ECU inventory, and manufacturer-specific live data after the bridge layer exists.
