Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 5000,5001 } |
  Select-Object LocalAddress, LocalPort, OwningProcess |
  Format-Table -AutoSize
