; DMS1 Inno Setup installer (compile with ISCC after installing Inno Setup)
#define MyAppName "A&E Auto Service DMS"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "A&E Auto Service Group Inc."
#define MyAppExeName "DMS1.exe"

[Setup]
AppName={#MyAppName}
AppVersion={#MyAppVersion}
Publisher={#MyAppPublisher}
DefaultDirName={pf}\DMS1
DefaultGroupName={#MyAppName}
OutputDir=.\output
OutputBaseFilename=DMS1-Setup
Compression=lzma
SolidCompression=yes

[Files]
Source: "..\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "node_modules\*, .git\*, installer\*"

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\start.bat"
Name: "{commondesktop}\{#MyAppName}"; Filename: "{app}\start.bat"

[Run]
Filename: "{app}\postinstall.bat"; Description: "Install Node dependencies"; Flags: runhidden waituntilterminated
