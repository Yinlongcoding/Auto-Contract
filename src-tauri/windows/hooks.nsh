!macro NSIS_HOOK_POSTUNINSTALL
  ; Remove the database and all app-owned user data after uninstall succeeds.
  RMDir /r "$APPDATA\com.zzyschemical.autocontract"
  RMDir /r "$LOCALAPPDATA\com.zzyschemical.autocontract"
!macroend
