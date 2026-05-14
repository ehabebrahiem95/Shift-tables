# Security Specification for Smart Shifts

## Data Invariants
- A shift must have a startTime earlier than endTime.
- A user can only edit their own availability.
- Only admins can assign shifts to other users or change shift status.
- Once a shift status is 'completed', it cannot be modified except by an admin.

## The Dirty Dozen Payloads (Denied Access)
1. Creating a user with `role: 'admin'` as a non-authenticated user.
2. Creating a shift as an 'employee'.
3. Deleting someone else's profile.
4. Changing a shift's `userId` as an 'employee'.
5. Updating `status` to 'confirmed' on a shift not owned by the user (if employee).
6. Injecting a 2MB string into `notes`.
7. Updating `createdAt` on an existing shift.
8. Listing all shifts without being signed in.
9. Creating a shift with `startTime` in the past.
10. Attempting to spoof `request.auth.uid`.
11. Bypassing `email_verified` (if required).
12. Accessing PII of other users as an employee.

## Conflict Report
| Collection | Identity Spoofing | State Shortcutting | Resource Poisoning |
| :--- | :--- | :--- | :--- |
| users | Protected | N/A | Size restricted |
| shifts | Protected | Locked after 'completed' | Size restricted |
