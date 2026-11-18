$ErrorActionPreference = 'Stop'
$base = Split-Path (Get-Process PBIDesktop | Select-Object -First 1 -ExpandProperty Path)
[void][Reflection.Assembly]::LoadFrom((Join-Path $base 'Microsoft.AnalysisServices.Server.Core.dll'))
[void][Reflection.Assembly]::LoadFrom((Join-Path $base 'Microsoft.AnalysisServices.Server.Tabular.dll'))
[void][Reflection.Assembly]::LoadFrom((Join-Path $base 'Microsoft.PowerBI.AdomdClient.dll'))
$workspaceRoot = 'C:\Users\Bronson\Microsoft\Power BI Desktop Store App\AnalysisServicesWorkspaces'
$ports = Get-ChildItem $workspaceRoot -Recurse -Filter msmdsrv.port.txt | Sort-Object LastWriteTime -Descending
$server = $null
foreach($p in $ports) {
    $candidate = New-Object Microsoft.AnalysisServices.Tabular.Server
    try {
        $port = (Get-Content $p.FullName -Raw).Replace([string][char]0,'').Trim()
        $candidate.Connect("Data Source=localhost:$port")
        $db = @($candidate.Databases | Where-Object { $_.Model.Tables.Contains('Orders') -and $_.Model.Tables.Contains('OrderItems') }) | Select-Object -First 1
        if($null -ne $db) {$server=$candidate; break}
        $candidate.Disconnect()
    } catch { Write-Output $_.Exception.Message }
}
if($null -eq $server) {throw 'No open Commerce Operations model found'}
if($env:COMMERCE_REFRESH -ne 'false') {
    $db.Model.RequestRefresh([Microsoft.AnalysisServices.Tabular.RefreshType]::Full)
    $db.Model.SaveChanges()
}
$connection = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("Data Source=localhost:$port;Initial Catalog=$($db.ID)")
$connection.Open()
function Query-Dax($query) {
    $command = $connection.CreateCommand(); $command.CommandText=$query
    $reader=$command.ExecuteReader();$rows=@()
    while($reader.Read()) {$row=[ordered]@{};for($i=0;$i -lt $reader.FieldCount;$i++){$row[$reader.GetName($i)]=$reader.GetValue($i)};$rows+=,$row}
    $reader.Close();return ,$rows
}
$all=Query-Dax 'EVALUATE ROW("Orders",[Order Count],"Delivered",[Delivered Orders],"Merchandise",[Delivered Merchandise Value],"Freight",[Delivered Freight Value],"Eligible",[Eligible Deliveries],"Late",[Late Orders],"OnTime",[On Time Rate])'
if($all[0]['[Orders]'] -ne 99441 -or [decimal]$all[0]['[Merchandise]'] -ne [decimal]13221498.11){throw ('DAX control mismatch: '+($all | ConvertTo-Json -Compress))}
$filtered=Query-Dax 'EVALUATE CALCULATETABLE(ROW("Merchandise",[Delivered Merchandise Value],"Orders",[Order Count]),Geography[state]="SP",Dates[year]=2017)'
$report=[ordered]@{verified_at=(Get-Date -Format o);method='Actual running Power BI Desktop Analysis Services model via TOM/ADOMD';refreshed=($env:COMMERCE_REFRESH -ne 'false');tables=$db.Model.Tables.Count;relationships=$db.Model.Relationships.Count;all=$all;filtered_sp_2017=$filtered;pbix_save_reopen_verified=$false}
$report | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 Z:\CommerceExplorer\desktop-verification.json
$report | ConvertTo-Json -Depth 12
$connection.Close();$server.Disconnect()
