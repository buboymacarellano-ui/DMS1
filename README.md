# A&E Auto Service DMS — User Manual

This is the shop management system for A&E Auto Service Group Inc. It keeps work orders, parts, staff records, sales, and approvals for all branches in one place.

This manual is for the people who use the system every day. If you are a developer or IT support, read **TECH-README.md** instead.

---

## Contents

1. [Opening the system](#1-opening-the-system)
2. [Logging in](#2-logging-in)
3. [What you see after login](#3-what-you-see-after-login)
4. [Moving around the screens](#4-moving-around-the-screens)
5. [Full screen and kiosk setup](#5-full-screen-and-kiosk-setup)
6. [Approvals and requests](#6-approvals-and-requests)
7. [Deleting records](#7-deleting-records)
8. [Logging out](#8-logging-out)
9. [Is my data safe?](#9-is-my-data-safe)
10. [Troubleshooting](#10-troubleshooting)
11. [Words you will see](#11-words-you-will-see)

---

## 1. Opening the system

There are two ways to reach the system. Your IT support will tell you which one your branch uses.

### Online (recommended — works from any branch)

Open your web browser and go to:

```
https://dms1-4l6e.onrender.com/auth/login
```

Save it as a bookmark so you do not have to type it every time.

This version works on any computer with internet. All branches see the same records.

### On this computer only

If the system is installed on one PC in your branch, open:

```
http://127.0.0.1:3000
```

This only works on that one computer, and only while the program is running. Records saved here stay on that computer.

### Which browser?

Google Chrome or Microsoft Edge. Both work on Windows and Mac. Do not use very old browsers.

---

## 2. Logging in

The login page asks for five things, in this order:

| Field | What to enter |
| --- | --- |
| **Department** | Pick your department from the list. |
| **Role** | Pick your job role. The choices change based on the department you picked. |
| **Employee ID** | Your assigned ID. |
| **Location / Branch** | Only appears for branch staff. Pick the branch you are assigned to. |
| **Password** | Your password. Minimum 6 characters. |

Press **Log In**.

**Important:** pick the correct branch. The system uses it to decide which work orders you are allowed to see and edit. If you pick the wrong branch, records from your real branch will be hidden from you.

If the login fails, an error message appears in red above the form. Read it — it usually says exactly what is wrong.

---

## 3. What you see after login

The system sends you straight to your own dashboard. You do not need to search for it.

| Your role | Where you land | What it is for |
| --- | --- | --- |
| General Manager (GM) | GM Dashboard | Company-wide view across all branches |
| Admin | Finance Office | Finance, assets and facilities, removed records |
| Service Technical Manager (STM) | STM Dashboard | Service operations and technician tracking |
| Technician | Technician screen | Jobs assigned to you and job status |
| Service Advisor / Receptionist | Service Receptionist Dashboard | Booking jobs, customers, vehicles |
| Parts Manager (PM) | Parts Manager screen | Approving parts requests, stock control |
| Parts Clerk | Parts Portal | Requesting and receiving parts |
| Operations / Store Manager | Stores Portal | Store operations |
| Cashier | Point of Sale (POS) | Ringing up sales |
| Stores Clerk | Stores Portal | Stock handling |
| HR staff | HR Portal | Employee records, shift rosters |
| Payroll | Payroll screen | Payroll processing |
| Finance Manager / Accounting | Accounting | Financial records |
| Assets & Facilities | FTE Tracking | Staffing and facilities |

You only see the screens your role is allowed to open. This is normal — it is not a fault. If you genuinely need access to something you cannot open, ask your manager to have your role updated. Do not share another person's login.

---

## 4. Moving around the screens

- **The company name at the top left** takes you back to the main page.
- **The menu links in the header** are your main screens.
- **The Back chip under the logo** goes back one screen.
- **Pressing the ESC key** also goes back one screen. This is the quickest way when you open something by mistake.
- **Approvals / Requests** in the header shows pending items. If there is a number beside it, that many items are waiting for you.

Your role and name are shown in the header so you can always confirm who is logged in. Branch staff also see their branch name there.

---

## 5. Full screen and kiosk setup

There are two different things here. They are easy to confuse, so read both.

### A. The Full Screen button (inside the system)

Every page has a **Full Screen** button in the top right corner.

- Click it once — the screen goes full and the button changes to **Exit Full Screen**.
- Click it again to go back to normal.
- The system remembers your choice on that computer. Next time you open it, it stays the way you left it.

If your browser blocks true full screen, the system still hides the extra parts of the page so you get the wider layout. You can press **F11** (Windows) or **Control + Command + F** (Mac) to force the browser into full screen.

### B. Kiosk mode (always full screen, no browser bars)

Use this for a terminal that should always be full screen — for example the GM station or a branch counter PC.

**This does not come from the system. It comes from how you open the browser.** A website is never allowed to force itself full screen the moment it opens — every browser blocks that for security. So we set it up in the shortcut instead.

#### Windows — Option 1: desktop shortcut (easiest)

1. Right-click on the desktop → **New** → **Shortcut**.
2. In the location box, paste this exactly:

   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --app=https://dms1-4l6e.onrender.com/auth/login
   ```

3. Click **Next**, name it `A&E DMS`, click **Finish**.
4. Double-click the shortcut. Chrome opens full screen with no tabs and no address bar.

To close it, press **Alt + F4**.

To make it open automatically when the PC starts: press `Windows key + R`, type `shell:startup`, press Enter, and copy the shortcut into the folder that opens.

#### Windows — Option 2: run it from the terminal

Useful for testing, or for IT setting up several PCs without clicking through the shortcut wizard.

**Command Prompt** — press `Windows key + R`, type `cmd`, press Enter. Then paste:

```
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --app=https://dms1-4l6e.onrender.com/auth/login
```

**PowerShell** — right-click the Start button → **Terminal** or **Windows PowerShell**. Then paste:

```powershell
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList '--kiosk','--app=https://dms1-4l6e.onrender.com/auth/login'
```

Either way, Chrome opens full screen. Close it with **Alt + F4**. You can close the terminal window afterwards — Chrome keeps running.

**If you get "cannot find the file":** Chrome is installed in the other Program Files folder. Use this path instead, in either command:

```
C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
```

**To save it as a reusable file:** open Notepad, paste the Command Prompt line above, and save it as `AE-DMS-Kiosk.bat` — in the Save dialog set **Save as type** to **All Files**, otherwise Notepad adds `.txt` and it will not run. Double-clicking that file now launches the kiosk. You can copy this one file to every branch PC.

#### Mac

1. Open the **Terminal** app.
2. Paste this exactly, then press Enter:

   ```
   open -na "Google Chrome" --args --kiosk --app=https://dms1-4l6e.onrender.com/auth/login
   ```

To close it, press **Command + Q**.

To make a clickable icon: open the **Script Editor** app, paste `do shell script "open -na \"Google Chrome\" --args --kiosk --app=https://dms1-4l6e.onrender.com/auth/login"`, then save it as an **Application**.

#### A gentler version

If full kiosk is too strict and staff still need the browser buttons, replace `--kiosk` with `--start-fullscreen` in any of the commands above. The window opens full screen but behaves like a normal browser.

#### If a kiosk terminal stopped opening full screen

This almost always means the shortcut or command is still pointing at the **old address**. When the system moved from a single PC to the online version, the address changed from `http://127.0.0.1:3000` to the online one.

**Fix the shortcut, not the system.** Right-click the shortcut → **Properties** → update the address in the Target box.

---

## 6. Approvals and requests

Some actions need someone else to say yes — for example a branch asking the warehouse for parts.

- The person who needs something submits a **request**.
- It appears under **Approvals** for whoever is allowed to approve it.
- The approver opens it, reviews it, and approves or rejects it.
- The requester then continues — for example, receiving the parts once they arrive.

If you have approval rights, the **Approvals** link in your header shows a count of items waiting. Check it daily. If you only submit requests, the same link is labelled **Requests**.

---

## 7. Deleting records

Deleting is protected. When you click a delete or remove button, the system asks for a **delete password** before anything is removed. This is separate from your login password — ask your manager for it.

If the password is wrong, nothing is deleted and you will see a message saying verification failed.

Treat deletion as permanent. If you are unsure, ask first. Admin users can review removed records under **Removed Records** in the Finance Office screen.

---

## 8. Logging out

Click **Log Out** in the top right corner of any page.

Always log out on shared computers. The next person who opens the browser would otherwise still be signed in as you, and anything they do would be recorded under your name.

---

## 9. Is my data safe?

Yes, with the normal care:

- Records are saved to a database the moment you save them. Refreshing the page, restarting the computer, or updating the system does not erase them.
- The online version keeps its records on a permanent company disk. Redeploying or updating the site does not wipe it.
- A backup copy is written automatically alongside the main database every time something is saved.
- Scheduled daily backups are set up separately by IT. Ask IT to confirm they are running and to test restoring one at least once a month.

What you should do:

- Use a strong password and do not share it.
- Do not let staff share one account. The system records who did what, and shared accounts destroy that record.
- Log out when you leave the computer.

---

## 10. Troubleshooting

**The login page will not open.**
Check the address is spelled correctly. If you use the online version, check the computer has internet. If you use the on-this-computer version, the program must be running on that PC — ask IT to start it.

**"Page not found" or a permission error after logging in.**
You opened a screen your role cannot access. Use the header links or press ESC to go back. If you should have access, ask your manager to update your role.

**I cannot see work orders I know exist.**
Check the branch shown in the header. Branch staff only see records for their assigned branch. If the branch is wrong, log out and log in again with the correct one.

**Full screen will not turn off.**
Click **Exit Full Screen** in the header. If you are in kiosk mode, use **Alt + F4** (Windows) or **Command + Q** (Mac) — kiosk mode has no exit button by design.

**The kiosk PC opens a normal window instead of full screen.**
The shortcut is wrong or pointing at the old address. See [section 5](#5-full-screen-and-kiosk-setup).

**Something looks broken or a number is wrong.**
Note the screen you were on, what you clicked, and what you expected. Send that to IT. Do not try to fix it by deleting and re-entering records — that can make it worse.

**How IT can check the system is healthy:** open the address with `/healthz` at the end. It should show `status: ok`.

---

## 11. Words you will see

| Word | Meaning |
| --- | --- |
| **Work Order (WO)** | The job record for one vehicle visit |
| **Portal** | A section of the system for one department — Service, Parts, Stores, HR, GM, Finance Office |
| **Grant** | A permission your role has, such as view, edit, or approve |
| **Approval Request** | A request sent to another department for a yes or no |
| **Branch** | One of the operating locations: Carx2, Carmen, CebuCity, Lapux2, Bogo, Toledo, ITPark |
| **Proposed Location** | A branch still being planned, not yet operating |
| **FTE** | Full-time equivalent — headcount tracking |
| **POS** | Point of Sale, the cashier screen |
| **Kiosk mode** | A browser opened locked to full screen with no tabs or address bar |
| **Health check** | A page IT uses to confirm the system is running |

---

## Need help?

Contact your IT support. Have this ready:

- Your role and branch
- The screen you were on
- What you clicked and what happened
- A photo or screenshot of any error message

Technical details are in **TECH-README.md** and **SECURE-OPERATIONS.md**.
