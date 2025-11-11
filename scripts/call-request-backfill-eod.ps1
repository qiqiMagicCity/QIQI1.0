param(
  [Parameter(Mandatory=$true)][string]$FunctionUrl,  # 触发地址(URL，统一资源定位符)，来自 Firebase 控制台的可调用函数(onCall)触发器
  [Parameter(Mandatory=$true)][string]$IdToken,      # 身份令牌(ID Token，身份认证生成)
  [string]$Date = (Get-Date -Format 'yyyy-MM-dd'),
  [string[]]$Symbols = @('GOOGL')
)

$headers = @{
  'Authorization' = "Bearer $IdToken"
  'Content-Type'  = 'application/json'
}

$bodyObj = @{
  data = @{
    date    = $Date
    symbols = $Symbols
  }
}
$bodyJson = $bodyObj | ConvertTo-Json -Depth 5

$invokeParams = @{
  Uri         = $FunctionUrl
  Method      = 'POST'
  Headers     = $headers
  ContentType = 'application/json'
  Body        = $bodyJson
}

try {
  $res = Invoke-WebRequest @invokeParams
  Write-Host "HTTP $($res.StatusCode)"
  if ($res.Content) {
    try {
      $parsed = $res.Content | ConvertFrom-Json
      if ($parsed.result) { $parsed.result | ConvertTo-Json -Depth 10 }
      else { $parsed | ConvertTo-Json -Depth 10 }
    } catch {
      Write-Host $res.Content
    }
  }
} catch {
  Write-Error $_
  if ($_.ErrorDetails.Message) {
    Write-Host "ErrorDetails:" $_.ErrorDetails.Message
  }
}
