import { useState, useMemo } from "react";
import {
  ComposedChart, LineChart, AreaChart,
  Area, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
  ReferenceArea
} from "recharts";

// ── Embedded CSV data ──────────────────────────────────────────────────────────
const FORECAST_DATA = [{"date":"2026-01-01","period":"backcast","pred_total":612.6,"pred_gpg":37.6,"pred_nonpwr":575.0,"pred_vic":273.4,"pred_nsw":216.0,"pred_sa":69.6,"pred_tas":16.0,"pred_nem":290870,"pred_wind":78855,"pred_solar":39893,"pred_hydro":18483,"pred_coal":161930,"pred_gas_mwh":4421},{"date":"2026-01-02","period":"backcast","pred_total":585.3,"pred_gpg":85.3,"pred_nonpwr":500.0,"pred_vic":219.2,"pred_nsw":202.1,"pred_sa":65.3,"pred_tas":13.4,"pred_nem":308343,"pred_wind":47793,"pred_solar":41778,"pred_hydro":24995,"pred_coal":188338,"pred_gas_mwh":10040},{"date":"2026-01-03","period":"backcast","pred_total":555.6,"pred_gpg":89.7,"pred_nonpwr":465.9,"pred_vic":199.7,"pred_nsw":196.1,"pred_sa":56.7,"pred_tas":13.4,"pred_nem":306296,"pred_wind":46095,"pred_solar":39275,"pred_hydro":24023,"pred_coal":189542,"pred_gas_mwh":10556},{"date":"2026-01-04","period":"backcast","pred_total":519.3,"pred_gpg":56.1,"pred_nonpwr":463.2,"pred_vic":206.9,"pred_nsw":183.3,"pred_sa":59.6,"pred_tas":13.3,"pred_nem":287877,"pred_wind":54836,"pred_solar":38035,"pred_hydro":21187,"pred_coal":175065,"pred_gas_mwh":6603},{"date":"2026-01-05","period":"backcast","pred_total":605.3,"pred_gpg":69.5,"pred_nonpwr":535.9,"pred_vic":245.0,"pred_nsw":213.2,"pred_sa":63.7,"pred_tas":14.0,"pred_nem":307632,"pred_wind":46271,"pred_solar":40923,"pred_hydro":23854,"pred_coal":190651,"pred_gas_mwh":8172},{"date":"2026-01-06","period":"backcast","pred_total":719.0,"pred_gpg":160.3,"pred_nonpwr":558.6,"pred_vic":254.7,"pred_nsw":227.6,"pred_sa":62.3,"pred_tas":14.0,"pred_nem":344129,"pred_wind":29755,"pred_solar":44788,"pred_hydro":32579,"pred_coal":217256,"pred_gas_mwh":18860},{"date":"2026-01-07","period":"backcast","pred_total":725.3,"pred_gpg":176.5,"pred_nonpwr":548.8,"pred_vic":236.7,"pred_nsw":229.1,"pred_sa":68.8,"pred_tas":14.2,"pred_nem":383015,"pred_wind":68516,"pred_solar":44058,"pred_hydro":32807,"pred_coal":219890,"pred_gas_mwh":20764},{"date":"2026-01-08","period":"backcast","pred_total":683.7,"pred_gpg":115.9,"pred_nonpwr":567.8,"pred_vic":245.2,"pred_nsw":239.9,"pred_sa":68.6,"pred_tas":14.1,"pred_nem":369018,"pred_wind":63801,"pred_solar":43533,"pred_hydro":27796,"pred_coal":218206,"pred_gas_mwh":13633},{"date":"2026-01-09","period":"backcast","pred_total":676.5,"pred_gpg":135.3,"pred_nonpwr":541.2,"pred_vic":237.6,"pred_nsw":227.5,"pred_sa":61.4,"pred_tas":14.7,"pred_nem":383272,"pred_wind":87507,"pred_solar":42405,"pred_hydro":28940,"pred_coal":213290,"pred_gas_mwh":15921},{"date":"2026-01-10","period":"backcast","pred_total":557.8,"pred_gpg":39.5,"pred_nonpwr":518.4,"pred_vic":238.1,"pred_nsw":199.7,"pred_sa":67.0,"pred_tas":13.5,"pred_nem":307715,"pred_wind":100134,"pred_solar":37468,"pred_hydro":19319,"pred_coal":164073,"pred_gas_mwh":4644},{"date":"2026-01-11","period":"backcast","pred_total":598.1,"pred_gpg":25.2,"pred_nonpwr":572.9,"pred_vic":281.3,"pred_nsw":212.7,"pred_sa":65.0,"pred_tas":13.9,"pred_nem":294505,"pred_wind":76236,"pred_solar":38104,"pred_hydro":19054,"pred_coal":167417,"pred_gas_mwh":2964},{"date":"2026-01-12","period":"backcast","pred_total":659.6,"pred_gpg":52.1,"pred_nonpwr":607.6,"pred_vic":283.7,"pred_nsw":242.3,"pred_sa":65.8,"pred_tas":15.8,"pred_nem":326849,"pred_wind":68193,"pred_solar":41607,"pred_hydro":22488,"pred_coal":190743,"pred_gas_mwh":6128},{"date":"2026-01-13","period":"backcast","pred_total":675.3,"pred_gpg":80.4,"pred_nonpwr":594.9,"pred_vic":272.7,"pred_nsw":240.0,"pred_sa":67.0,"pred_tas":15.3,"pred_nem":333106,"pred_wind":59055,"pred_solar":42272,"pred_hydro":24558,"pred_coal":199769,"pred_gas_mwh":9459},{"date":"2026-01-14","period":"backcast","pred_total":672.1,"pred_gpg":74.6,"pred_nonpwr":597.5,"pred_vic":273.3,"pred_nsw":244.8,"pred_sa":64.0,"pred_tas":15.4,"pred_nem":337846,"pred_wind":69630,"pred_solar":39945,"pred_hydro":23554,"pred_coal":197841,"pred_gas_mwh":8779},{"date":"2026-01-15","period":"backcast","pred_total":666.0,"pred_gpg":59.5,"pred_nonpwr":606.5,"pred_vic":272.0,"pred_nsw":247.8,"pred_sa":71.3,"pred_tas":15.4,"pred_nem":335720,"pred_wind":84956,"pred_solar":36944,"pred_hydro":21456,"pred_coal":188188,"pred_gas_mwh":7002},{"date":"2026-01-16","period":"backcast","pred_total":621.0,"pred_gpg":33.3,"pred_nonpwr":587.6,"pred_vic":273.8,"pred_nsw":231.8,"pred_sa":67.3,"pred_tas":14.7,"pred_nem":323854,"pred_wind":101753,"pred_solar":38887,"pred_hydro":18380,"pred_coal":167336,"pred_gas_mwh":3923},{"date":"2026-01-17","period":"backcast","pred_total":556.3,"pred_gpg":28.5,"pred_nonpwr":527.8,"pred_vic":237.6,"pred_nsw":216.5,"pred_sa":59.6,"pred_tas":14.1,"pred_nem":302124,"pred_wind":95463,"pred_solar":39524,"pred_hydro":17245,"pred_coal":158201,"pred_gas_mwh":3352},{"date":"2026-01-18","period":"backcast","pred_total":589.0,"pred_gpg":49.4,"pred_nonpwr":539.6,"pred_vic":236.5,"pred_nsw":227.7,"pred_sa":61.1,"pred_tas":14.4,"pred_nem":306697,"pred_wind":77214,"pred_solar":39539,"pred_hydro":19709,"pred_coal":172369,"pred_gas_mwh":5806},{"date":"2026-01-19","period":"backcast","pred_total":660.4,"pred_gpg":77.8,"pred_nonpwr":582.5,"pred_vic":258.9,"pred_nsw":248.4,"pred_sa":59.6,"pred_tas":15.6,"pred_nem":347223,"pred_wind":82370,"pred_solar":40392,"pred_hydro":22955,"pred_coal":196166,"pred_gas_mwh":9158},{"date":"2026-01-20","period":"backcast","pred_total":730.6,"pred_gpg":119.5,"pred_nonpwr":611.1,"pred_vic":275.6,"pred_nsw":260.0,"pred_sa":59.1,"pred_tas":16.4,"pred_nem":334414,"pred_wind":58831,"pred_solar":40355,"pred_hydro":23830,"pred_coal":201878,"pred_gas_mwh":14063},{"date":"2026-01-21","period":"backcast","pred_total":662.4,"pred_gpg":42.7,"pred_nonpwr":619.7,"pred_vic":282.9,"pred_nsw":252.9,"pred_sa":67.0,"pred_tas":16.9,"pred_nem":325410,"pred_wind":72091,"pred_solar":38170,"pred_hydro":21559,"pred_coal":189158,"pred_gas_mwh":5028},{"date":"2026-01-22","period":"backcast","pred_total":700.0,"pred_gpg":30.4,"pred_nonpwr":669.6,"pred_vic":329.5,"pred_nsw":252.5,"pred_sa":71.3,"pred_tas":16.2,"pred_nem":324413,"pred_wind":77661,"pred_solar":41574,"pred_hydro":21030,"pred_coal":183380,"pred_gas_mwh":3580},{"date":"2026-01-23","period":"backcast","pred_total":672.7,"pred_gpg":62.0,"pred_nonpwr":610.8,"pred_vic":280.7,"pred_nsw":240.4,"pred_sa":73.6,"pred_tas":16.0,"pred_nem":330278,"pred_wind":48716,"pred_solar":43716,"pred_hydro":24886,"pred_coal":204517,"pred_gas_mwh":7289},{"date":"2026-01-24","period":"backcast","pred_total":715.2,"pred_gpg":175.9,"pred_nonpwr":539.3,"pred_vic":233.6,"pred_nsw":220.8,"pred_sa":70.0,"pred_tas":14.9,"pred_nem":369337,"pred_wind":57289,"pred_solar":42878,"pred_hydro":33828,"pred_coal":214112,"pred_gas_mwh":20698},{"date":"2026-01-25","period":"backcast","pred_total":581.7,"pred_gpg":70.7,"pred_nonpwr":511.1,"pred_vic":223.7,"pred_nsw":203.6,"pred_sa":68.6,"pred_tas":15.2,"pred_nem":323354,"pred_wind":49046,"pred_solar":40843,"pred_hydro":26034,"pred_coal":200599,"pred_gas_mwh":8317},{"date":"2026-01-26","period":"backcast","pred_total":788.2,"pred_gpg":191.3,"pred_nonpwr":597.0,"pred_vic":267.9,"pred_nsw":237.4,"pred_sa":75.1,"pred_tas":16.6,"pred_nem":372048,"pred_wind":43685,"pred_solar":42968,"pred_hydro":36172,"pred_coal":226353,"pred_gas_mwh":22501},{"date":"2026-01-27","period":"backcast","pred_total":799.4,"pred_gpg":208.6,"pred_nonpwr":590.7,"pred_vic":259.0,"pred_nsw":244.1,"pred_sa":70.3,"pred_tas":17.3,"pred_nem":395267,"pred_wind":69930,"pred_solar":43730,"pred_hydro":34894,"pred_coal":226467,"pred_gas_mwh":24546},{"date":"2026-01-28","period":"backcast","pred_total":676.3,"pred_gpg":80.0,"pred_nonpwr":596.3,"pred_vic":263.2,"pred_nsw":245.7,"pred_sa":70.3,"pred_tas":17.1,"pred_nem":348234,"pred_wind":65179,"pred_solar":38096,"pred_hydro":24145,"pred_coal":210800,"pred_gas_mwh":9411},{"date":"2026-01-29","period":"backcast","pred_total":699.4,"pred_gpg":84.7,"pred_nonpwr":614.7,"pred_vic":278.1,"pred_nsw":245.4,"pred_sa":73.7,"pred_tas":17.5,"pred_nem":353912,"pred_wind":65626,"pred_solar":39217,"pred_hydro":25613,"pred_coal":212963,"pred_gas_mwh":9961},{"date":"2026-01-30","period":"backcast","pred_total":731.7,"pred_gpg":149.6,"pred_nonpwr":582.1,"pred_vic":259.8,"pred_nsw":233.4,"pred_sa":71.7,"pred_tas":17.2,"pred_nem":381056,"pred_wind":52039,"pred_solar":41209,"pred_hydro":33425,"pred_coal":232491,"pred_gas_mwh":17595},{"date":"2026-01-31","period":"backcast","pred_total":574.6,"pred_gpg":65.1,"pred_nonpwr":509.6,"pred_vic":227.7,"pred_nsw":205.2,"pred_sa":61.3,"pred_tas":15.4,"pred_nem":332881,"pred_wind":51860,"pred_solar":38047,"pred_hydro":24678,"pred_coal":206723,"pred_gas_mwh":7656},{"date":"2026-02-01","period":"backcast","pred_total":583.7,"pred_gpg":25.5,"pred_nonpwr":558.2,"pred_vic":280.2,"pred_nsw":201.7,"pred_sa":61.1,"pred_tas":15.3,"pred_nem":302441,"pred_wind":86556,"pred_solar":32314,"pred_hydro":18685,"pred_coal":169168,"pred_gas_mwh":2999},{"date":"2026-02-02","period":"backcast","pred_total":705.1,"pred_gpg":21.9,"pred_nonpwr":683.2,"pred_vic":335.9,"pred_nsw":258.9,"pred_sa":71.0,"pred_tas":17.5,"pred_nem":330305,"pred_wind":82249,"pred_solar":40525,"pred_hydro":21348,"pred_coal":183046,"pred_gas_mwh":2578},{"date":"2026-02-03","period":"backcast","pred_total":729.5,"pred_gpg":103.8,"pred_nonpwr":625.7,"pred_vic":289.3,"pred_nsw":251.3,"pred_sa":67.5,"pred_tas":17.6,"pred_nem":355016,"pred_wind":59890,"pred_solar":37933,"pred_hydro":28724,"pred_coal":213589,"pred_gas_mwh":12208},{"date":"2026-02-04","period":"backcast","pred_total":718.3,"pred_gpg":116.1,"pred_nonpwr":602.2,"pred_vic":274.3,"pred_nsw":244.5,"pred_sa":65.9,"pred_tas":17.4,"pred_nem":360977,"pred_wind":47234,"pred_solar":42272,"pred_hydro":29643,"pred_coal":221166,"pred_gas_mwh":13655},{"date":"2026-02-05","period":"backcast","pred_total":680.8,"pred_gpg":73.7,"pred_nonpwr":607.0,"pred_vic":283.3,"pred_nsw":239.7,"pred_sa":66.8,"pred_tas":17.3,"pred_nem":339047,"pred_wind":50387,"pred_solar":40314,"pred_hydro":26098,"pred_coal":208539,"pred_gas_mwh":8675},{"date":"2026-02-06","period":"backcast","pred_total":697.5,"pred_gpg":109.8,"pred_nonpwr":587.6,"pred_vic":274.8,"pred_nsw":229.9,"pred_sa":66.5,"pred_tas":16.4,"pred_nem":335481,"pred_wind":41204,"pred_solar":40450,"pred_hydro":28159,"pred_coal":207153,"pred_gas_mwh":12922},{"date":"2026-02-07","period":"backcast","pred_total":613.9,"pred_gpg":91.3,"pred_nonpwr":522.6,"pred_vic":238.6,"pred_nsw":203.1,"pred_sa":65.3,"pred_tas":15.6,"pred_nem":315565,"pred_wind":38804,"pred_solar":33600,"pred_hydro":26784,"pred_coal":199557,"pred_gas_mwh":10741},{"date":"2026-02-08","period":"backcast","pred_total":596.5,"pred_gpg":91.8,"pred_nonpwr":504.6,"pred_vic":219.1,"pred_nsw":204.6,"pred_sa":65.6,"pred_tas":15.3,"pred_nem":321200,"pred_wind":53968,"pred_solar":30736,"pred_hydro":25152,"pred_coal":195168,"pred_gas_mwh":10805},{"date":"2026-02-09","period":"backcast","pred_total":738.0,"pred_gpg":150.3,"pred_nonpwr":587.7,"pred_vic":269.4,"pred_nsw":233.5,"pred_sa":67.8,"pred_tas":16.9,"pred_nem":340807,"pred_wind":38101,"pred_solar":34768,"pred_hydro":31959,"pred_coal":212906,"pred_gas_mwh":17688},{"date":"2026-02-10","period":"backcast","pred_total":838.9,"pred_gpg":227.3,"pred_nonpwr":611.5,"pred_vic":273.3,"pred_nsw":247.7,"pred_sa":73.6,"pred_tas":16.9,"pred_nem":353069,"pred_wind":25294,"pred_solar":39599,"pred_hydro":37821,"pred_coal":219637,"pred_gas_mwh":26747},{"date":"2026-02-11","period":"backcast","pred_total":731.8,"pred_gpg":124.5,"pred_nonpwr":607.3,"pred_vic":276.4,"pred_nsw":243.8,"pred_sa":70.6,"pred_tas":16.5,"pred_nem":365888,"pred_wind":73271,"pred_solar":34585,"pred_hydro":28016,"pred_coal":212393,"pred_gas_mwh":14648},{"date":"2026-02-12","period":"backcast","pred_total":739.4,"pred_gpg":60.6,"pred_nonpwr":678.8,"pred_vic":339.5,"pred_nsw":247.7,"pred_sa":74.1,"pred_tas":17.5,"pred_nem":329715,"pred_wind":86732,"pred_solar":33091,"pred_hydro":21577,"pred_coal":182994,"pred_gas_mwh":7126},{"date":"2026-02-13","period":"backcast","pred_total":728.0,"pred_gpg":68.3,"pred_nonpwr":659.7,"pred_vic":322.6,"pred_nsw":248.5,"pred_sa":71.9,"pred_tas":16.8,"pred_nem":331437,"pred_wind":76524,"pred_solar":37642,"pred_hydro":22106,"pred_coal":188380,"pred_gas_mwh":8033},{"date":"2026-02-14","period":"backcast","pred_total":612.3,"pred_gpg":79.3,"pred_nonpwr":533.0,"pred_vic":239.6,"pred_nsw":211.3,"pred_sa":67.9,"pred_tas":14.2,"pred_nem":305758,"pred_wind":67939,"pred_solar":37615,"pred_hydro":20032,"pred_coal":175762,"pred_gas_mwh":9331},{"date":"2026-02-15","period":"backcast","pred_total":630.4,"pred_gpg":108.6,"pred_nonpwr":521.8,"pred_vic":228.7,"pred_nsw":215.0,"pred_sa":63.5,"pred_tas":14.6,"pred_nem":316854,"pred_wind":54324,"pred_solar":40808,"pred_hydro":23021,"pred_coal":187387,"pred_gas_mwh":12782},{"date":"2026-02-16","period":"backcast","pred_total":794.9,"pred_gpg":210.5,"pred_nonpwr":584.3,"pred_vic":256.9,"pred_nsw":238.9,"pred_sa":71.9,"pred_tas":16.7,"pred_nem":387991,"pred_wind":68778,"pred_solar":41365,"pred_hydro":37653,"pred_coal":213700,"pred_gas_mwh":24769},{"date":"2026-02-17","period":"backcast","pred_total":712.7,"pred_gpg":99.1,"pred_nonpwr":613.6,"pred_vic":279.2,"pred_nsw":244.8,"pred_sa":73.4,"pred_tas":16.2,"pred_nem":373342,"pred_wind":90264,"pred_solar":37542,"pred_hydro":26477,"pred_coal":203125,"pred_gas_mwh":11657},{"date":"2026-02-18","period":"backcast","pred_total":705.3,"pred_gpg":98.7,"pred_nonpwr":606.7,"pred_vic":284.6,"pred_nsw":234.2,"pred_sa":71.0,"pred_tas":16.8,"pred_nem":340923,"pred_wind":58180,"pred_solar":38293,"pred_hydro":27201,"pred_coal":201392,"pred_gas_mwh":11610},{"date":"2026-02-19","period":"backcast","pred_total":720.4,"pred_gpg":112.3,"pred_nonpwr":608.1,"pred_vic":284.8,"pred_nsw":237.6,"pred_sa":68.8,"pred_tas":16.9,"pred_nem":345776,"pred_wind":47346,"pred_solar":40472,"pred_hydro":28693,"pred_coal":209454,"pred_gas_mwh":13210},{"date":"2026-02-20","period":"backcast","pred_total":790.9,"pred_gpg":195.8,"pred_nonpwr":595.1,"pred_vic":273.7,"pred_nsw":229.5,"pred_sa":75.9,"pred_tas":16.0,"pred_nem":367181,"pred_wind":40513,"pred_solar":40263,"pred_hydro":38738,"pred_coal":219885,"pred_gas_mwh":23035},{"date":"2026-02-21","period":"backcast","pred_total":639.7,"pred_gpg":106.6,"pred_nonpwr":533.1,"pred_vic":231.1,"pred_nsw":216.4,"pred_sa":70.9,"pred_tas":14.8,"pred_nem":332824,"pred_wind":38175,"pred_solar":37416,"pred_hydro":29056,"pred_coal":205835,"pred_gas_mwh":12540},{"date":"2026-02-22","period":"backcast","pred_total":613.2,"pred_gpg":88.1,"pred_nonpwr":525.2,"pred_vic":236.0,"pred_nsw":211.8,"pred_sa":63.3,"pred_tas":14.0,"pred_nem":334077,"pred_wind":65146,"pred_solar":23581,"pred_hydro":25660,"pred_coal":201943,"pred_gas_mwh":10361},{"date":"2026-02-23","period":"backcast","pred_total":676.5,"pred_gpg":93.2,"pred_nonpwr":583.3,"pred_vic":272.2,"pred_nsw":223.6,"pred_sa":72.8,"pred_tas":14.7,"pred_nem":334115,"pred_wind":52187,"pred_solar":32290,"pred_hydro":26153,"pred_coal":204606,"pred_gas_mwh":10965},{"date":"2026-02-24","period":"backcast","pred_total":739.8,"pred_gpg":131.3,"pred_nonpwr":608.5,"pred_vic":272.4,"pred_nsw":246.9,"pred_sa":73.2,"pred_tas":16.0,"pred_nem":348962,"pred_wind":44640,"pred_solar":36227,"pred_hydro":28766,"pred_coal":215376,"pred_gas_mwh":15447},{"date":"2026-02-25","period":"backcast","pred_total":680.8,"pred_gpg":64.0,"pred_nonpwr":616.8,"pred_vic":284.0,"pred_nsw":243.7,"pred_sa":73.2,"pred_tas":15.9,"pred_nem":337130,"pred_wind":78970,"pred_solar":32587,"pred_hydro":21616,"pred_coal":194273,"pred_gas_mwh":7530},{"date":"2026-02-26","period":"backcast","pred_total":688.4,"pred_gpg":75.5,"pred_nonpwr":612.9,"pred_vic":278.6,"pred_nsw":244.6,"pred_sa":73.8,"pred_tas":15.9,"pred_nem":349670,"pred_wind":78005,"pred_solar":34322,"pred_hydro":22979,"pred_coal":201081,"pred_gas_mwh":8880},{"date":"2026-02-27","period":"backcast","pred_total":756.6,"pred_gpg":150.6,"pred_nonpwr":605.9,"pred_vic":264.3,"pred_nsw":247.2,"pred_sa":79.9,"pred_tas":14.5,"pred_nem":366434,"pred_wind":55678,"pred_solar":35915,"pred_hydro":31641,"pred_coal":216746,"pred_gas_mwh":17722},{"date":"2026-02-28","period":"backcast","pred_total":625.4,"pred_gpg":108.7,"pred_nonpwr":516.7,"pred_vic":225.1,"pred_nsw":212.8,"pred_sa":65.2,"pred_tas":13.6,"pred_nem":342083,"pred_wind":59772,"pred_solar":31267,"pred_hydro":27979,"pred_coal":203909,"pred_gas_mwh":12787},{"date":"2026-03-01","period":"backcast","pred_total":600.3,"pred_gpg":83.2,"pred_nonpwr":517.1,"pred_vic":225.4,"pred_nsw":212.7,"pred_sa":65.2,"pred_tas":13.8,"pred_nem":329205,"pred_wind":80085,"pred_solar":21803,"pred_hydro":23776,"pred_coal":191062,"pred_gas_mwh":9790},{"date":"2026-03-02","period":"backcast","pred_total":716.4,"pred_gpg":128.0,"pred_nonpwr":588.4,"pred_vic":268.1,"pred_nsw":235.7,"pred_sa":68.8,"pred_tas":15.7,"pred_nem":354497,"pred_wind":65923,"pred_solar":20194,"pred_hydro":29286,"pred_coal":216962,"pred_gas_mwh":15057},{"date":"2026-03-03","period":"backcast","pred_total":751.4,"pred_gpg":122.9,"pred_nonpwr":628.5,"pred_vic":291.5,"pred_nsw":247.4,"pred_sa":72.5,"pred_tas":17.2,"pred_nem":334815,"pred_wind":52041,"pred_solar":26928,"pred_hydro":28689,"pred_coal":205438,"pred_gas_mwh":14460},{"date":"2026-03-04","period":"backcast","pred_total":781.2,"pred_gpg":155.9,"pred_nonpwr":625.3,"pred_vic":280.9,"pred_nsw":251.6,"pred_sa":76.0,"pred_tas":16.8,"pred_nem":335527,"pred_wind":37719,"pred_solar":33922,"pred_hydro":31709,"pred_coal":207943,"pred_gas_mwh":18343},{"date":"2026-03-05","period":"backcast","pred_total":778.6,"pred_gpg":159.6,"pred_nonpwr":619.0,"pred_vic":284.5,"pred_nsw":244.6,"pred_sa":73.8,"pred_tas":16.1,"pred_nem":335779,"pred_wind":33645,"pred_solar":38962,"pred_hydro":32528,"pred_coal":205364,"pred_gas_mwh":18780},{"date":"2026-03-06","period":"forecast","pred_total":755.7,"pred_gpg":161.3,"pred_nonpwr":594.5,"pred_vic":272.7,"pred_nsw":235.1,"pred_sa":71.2,"pred_tas":15.4,"pred_nem":337274,"pred_wind":37141,"pred_solar":35986,"pred_hydro":31523,"pred_coal":208648,"pred_gas_mwh":18972},{"date":"2026-03-07","period":"forecast","pred_total":610.6,"pred_gpg":85.2,"pred_nonpwr":525.4,"pred_vic":237.7,"pred_nsw":210.4,"pred_sa":62.0,"pred_tas":15.3,"pred_nem":308769,"pred_wind":66292,"pred_solar":35842,"pred_hydro":22142,"pred_coal":177403,"pred_gas_mwh":10028},{"date":"2026-03-08","period":"forecast","pred_total":581.5,"pred_gpg":65.3,"pred_nonpwr":516.2,"pred_vic":239.9,"pred_nsw":204.0,"pred_sa":58.2,"pred_tas":14.1,"pred_nem":304302,"pred_wind":79736,"pred_solar":34075,"pred_hydro":20091,"pred_coal":169641,"pred_gas_mwh":7684},{"date":"2026-03-09","period":"forecast","pred_total":713.1,"pred_gpg":117.8,"pred_nonpwr":595.3,"pred_vic":265.3,"pred_nsw":247.9,"pred_sa":65.9,"pred_tas":16.2,"pred_nem":343040,"pred_wind":54292,"pred_solar":35879,"pred_hydro":30820,"pred_coal":202608,"pred_gas_mwh":13862},{"date":"2026-03-10","period":"forecast","pred_total":820.0,"pred_gpg":201.3,"pred_nonpwr":618.7,"pred_vic":273.9,"pred_nsw":256.7,"pred_sa":71.5,"pred_tas":16.6,"pred_nem":358110,"pred_wind":36528,"pred_solar":39011,"pred_hydro":39302,"pred_coal":213661,"pred_gas_mwh":23684},{"date":"2026-03-11","period":"forecast","pred_total":865.6,"pred_gpg":234.2,"pred_nonpwr":631.4,"pred_vic":267.2,"pred_nsw":267.6,"pred_sa":79.8,"pred_tas":16.8,"pred_nem":387616,"pred_wind":84788,"pred_solar":39701,"pred_hydro":34588,"pred_coal":203070,"pred_gas_mwh":27554},{"date":"2026-03-12","period":"forecast","pred_total":752.6,"pred_gpg":155.1,"pred_nonpwr":597.5,"pred_vic":257.2,"pred_nsw":255.8,"pred_sa":67.3,"pred_tas":17.1,"pred_nem":367105,"pred_wind":68188,"pred_solar":33791,"pred_hydro":31502,"pred_coal":213176,"pred_gas_mwh":18250}];

const POE_DATA = {"2026-03-06":{"p10_total":677.9,"p90_total":812.3,"p10_gpg":125.2,"p90_gpg":183.6,"p10_nonpwr":525.5,"p90_nonpwr":646.4},"2026-03-07":{"p10_total":545.4,"p90_total":676.5,"p10_gpg":54.7,"p90_gpg":106.4,"p10_nonpwr":467.7,"p90_nonpwr":587.8},"2026-03-08":{"p10_total":520.4,"p90_total":648.6,"p10_gpg":34.8,"p90_gpg":85.8,"p10_nonpwr":463.2,"p90_nonpwr":580.0},"2026-03-09":{"p10_total":640.9,"p90_total":774.0,"p10_gpg":87.3,"p90_gpg":140.5,"p10_nonpwr":529.8,"p90_nonpwr":651.8},"2026-03-10":{"p10_total":741.8,"p90_total":880.3,"p10_gpg":150.5,"p90_gpg":224.1,"p10_nonpwr":559.3,"p90_nonpwr":674.5},"2026-03-11":{"p10_total":829.8,"p90_total":933.4,"p10_gpg":198.7,"p90_gpg":262.1,"p10_nonpwr":627.5,"p90_nonpwr":693.2},"2026-03-12":{"p10_total":690.6,"p90_total":819.1,"p10_gpg":112.2,"p90_gpg":178.1,"p10_nonpwr":552.8,"p90_nonpwr":659.9}};

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmtDate = (d) => {
  const [,, dd] = d.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const m = parseInt(d.split('-')[1]) - 1;
  return `${parseInt(dd)}-${months[m]}`;
};

// Actuals sourced from GBB records — no dummy data needed

// Styles
const C = {
  bg:        '#0d1117',
  surface:   '#161b22',
  surface2:  '#1c2128',
  border:    '#30363d',
  text:      '#e6edf3',
  muted:     '#8b949e',
  dim:       '#484f58',
  blue:      '#388bfd',
  orange:    '#e6a817',
  green:     '#3fb950',
  red:       '#f85149',
  purple:    '#bc8cff',
  teal:      '#39d0d8',
  // NEM stack colours
  coal:      '#6e7681',
  wind:      '#3fb950',
  solar:     '#e6a817',
  hydro:     '#39d0d8',
  gas:       '#388bfd',
  other:     '#bc8cff',
  // Forecast colours
  forecast:  '#388bfd',
  actual:    '#e6a817',
  poe:       'rgba(56,139,253,0.15)',
};

const AXIS = { tick: { fill: C.muted, fontSize: 11 }, axisLine: false, tickLine: false };
const GRID = { stroke: C.border, strokeDasharray: '3 3', vertical: false };

// ── Shared chart elements ──────────────────────────────────────────────────────
const ChartCard = ({ title, subtitle, children, style = {} }) => (
  <div style={{
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
    padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, ...style
  }}>
    <div>
      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 13, color: C.text }}>{title}</div>
      {subtitle && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{subtitle}</div>}
    </div>
    {children}
  </div>
);

const CustomTooltip = ({ active, payload, label, unit = 'TJ/day' }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 14px', fontSize: 12 }}>
      <div style={{ color: C.muted, marginBottom: 6, fontFamily: 'DM Mono, monospace' }}>{label}</div>
      {payload.filter(p => p.value != null && !String(p.name).startsWith('__')).map((p, i) => (
        <div key={i} style={{ color: p.color || C.text, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <span>{p.name}</span>
          <span style={{ fontFamily: 'DM Mono, monospace' }}>{typeof p.value === 'number' ? p.value.toFixed(1) : p.value} {unit}</span>
        </div>
      ))}
    </div>
  );
};

const NEMTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 14px', fontSize: 12 }}>
      <div style={{ color: C.muted, marginBottom: 6, fontFamily: 'DM Mono, monospace' }}>{label}</div>
      {[...payload].reverse().map((p, i) => (
        <div key={i} style={{ color: p.fill || C.text, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <span>{p.name}</span>
          <span style={{ fontFamily: 'DM Mono, monospace' }}>{(p.value/1000).toFixed(0)} GWh</span>
        </div>
      ))}
      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 6, paddingTop: 6, color: C.text, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
        <span>Total</span>
        <span style={{ fontFamily: 'DM Mono, monospace' }}>{(total/1000).toFixed(0)} GWh</span>
      </div>
    </div>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────
export default function TabForecast({ records = [], selectedYears = [2026], forecastData = null, forecastPoeData = null, forecastDate = null }) {

  // Resolve: use uploaded prop data if available, else fall back to embedded constants
  const resolvedForecast = forecastData ?? FORECAST_DATA;
  const resolvedPoe      = forecastPoeData ?? POE_DATA;

  // Build chart data
  // Build date-keyed lookup from GBB records for actuals
  const gbbByDate = useMemo(() => {
    const m = {};
    for (const r of records) {
      m[r.date] = r;
    }
    return m;
  }, [records]);

  const chartData = useMemo(() => {
    return resolvedForecast.map(r => {
      const poe = resolvedPoe[r.date];
      const gbb = gbbByDate[r.date];
      // Actuals from GBB records where available
      const actual_total  = gbb ? Math.round(gbb.total_demand_se * 10) / 10 : null;
      const actual_gpg    = gbb ? Math.round(gbb.gpg_se          * 10) / 10 : null;
      const actual_nonpwr = gbb ? Math.round((gbb.industrial + gbb.residential) * 10) / 10 : null;
      const actual_vic    = gbb ? Math.round((gbb.pipe_vic - gbb.gpg_vic) * 10) / 10 : null;
      const actual_nsw    = gbb ? Math.round((gbb.pipe_nsw - gbb.gpg_nsw) * 10) / 10 : null;
      const actual_sa     = gbb ? Math.round((gbb.pipe_sa  - gbb.gpg_sa)  * 10) / 10 : null;
      const actual_tas    = gbb ? Math.round((gbb.pipe_tas - gbb.gpg_tas) * 10) / 10 : null;
      // NEM stack
      const residual = Math.max(0, r.pred_nem - r.pred_wind - r.pred_solar - r.pred_hydro - r.pred_coal - r.pred_gas_mwh);
      return {
        ...r,
        label: fmtDate(r.date),
        actual_total, actual_gpg, actual_nonpwr,
        actual_vic, actual_nsw, actual_sa, actual_tas,
        // POE band: [low, high-low] for area stacking
        poe_total_lo:  poe ? poe.p10_total  : null,
        poe_total_hi:  poe ? poe.p90_total  : null,
        poe_gpg_lo:    poe ? poe.p10_gpg    : null,
        poe_gpg_hi:    poe ? poe.p90_gpg    : null,
        poe_nonpwr_lo: poe ? poe.p10_nonpwr : null,
        poe_nonpwr_hi: poe ? poe.p90_nonpwr : null,
        // NEM stack (MWh)
        coal:     r.pred_coal,
        wind:     r.pred_wind,
        solar:    r.pred_solar,
        hydro:    r.pred_hydro,
        gas_mwh:  r.pred_gas_mwh,
        residual,
      };
    });
  }, [resolvedForecast, resolvedPoe, gbbByDate]);

  const forecastStart = resolvedForecast.find(r => r.period === 'forecast')?.date;
  const latestDate = resolvedForecast[resolvedForecast.length - 1]?.date;

  // ── Empty state (must be before todayRow which requires data) ─────────────────
  if (!resolvedForecast?.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 400, gap: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 40 }}>📈</div>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>No forecast data loaded</div>

        {/* File download links */}
        <div style={{ background: 'var(--surface-2, #161b22)', border: '1px solid var(--border, #30363d)', borderRadius: 8, padding: '16px 24px', maxWidth: 480, width: '100%', textAlign: 'left' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, fontFamily: 'DM Mono, monospace' }}>Available data files</div>
          {[
            { label: 'Gas demand forecast (main)',  file: forecastDate ? `gas_forecast_${forecastDate}.csv`     : 'gas_forecast_latest.csv' },
            { label: 'Gas demand forecast (PoE)',   file: forecastDate ? `gas_forecast_poe_${forecastDate}.csv` : 'gas_forecast_poe_latest.csv' },
            { label: 'DWGM prices',                 file: 'DWGM.XLSX' },
            { label: 'STTM prices',                 file: 'STTM.XLSX' },
          ].map(({ label, file }) => (
            <div key={file} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border, #30363d)' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
              <a href={`/data/${file}`} download style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', color: '#39d0d8', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                ⬇ {file}
              </a>
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, fontFamily: 'DM Mono, monospace' }}>
            Files updated daily · select all at once with ↑ Load data
          </div>
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 400, lineHeight: 1.6 }}>
          Download the files above, then use <strong style={{ color: 'var(--text)' }}>↑ Load data</strong> to upload them.
          You can select multiple files at once — forecast, PoE, DWGM and STTM all upload in one go.
        </div>
      </div>
    );
  }

  // ── Gas demand chart (with actuals + forecast + POE band) ─────────────────────
  const GasDemandChart = ({ title, subtitle, predKey, actualKey, poeLoKey, poeHiKey, color = C.blue, yDomain }) => {
    const data = chartData.map(r => ({
      label: r.label,
      date:  r.date,
      period: r.period,
      forecast: r[predKey],
      actual:   r[actualKey],
      poe_lo:   r[poeLoKey],
      poe_hi:   r[poeHiKey],
      // For area rendering: [lo, spread]
      poe_base: r[poeLoKey],
      poe_span: r[poeHiKey] != null && r[poeLoKey] != null ? r[poeHiKey] - r[poeLoKey] : null,
    }));

    return (
      <ChartCard title={title} subtitle={subtitle}>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" {...AXIS} interval={9} />
            <YAxis {...AXIS} width={38} domain={yDomain || ['auto','auto']} unit="" tickFormatter={v => v} />
            <Tooltip content={<CustomTooltip unit="TJ/day" />} />
            {/* POE band: invisible floor + shaded span */}
            <Area dataKey="poe_base" stackId="poe" stroke="none" fill="none" legendType="none" name="__hidden__" />
            <Area dataKey="poe_span" stackId="poe" stroke="none" fill={color} fillOpacity={0.35} legendType="none" name="__hidden__" />
            {/* PoE boundary lines */}
            <Line dataKey="poe_lo" stroke={color} strokeWidth={1} strokeDasharray="3 3" dot={false} name="PoE 10" connectNulls />
            <Line dataKey="poe_hi" stroke={color} strokeWidth={1} strokeDasharray="3 3" dot={false} name="PoE 90" connectNulls />
            {/* Forecast */}
            <Line dataKey="forecast" stroke={color} strokeWidth={2} dot={false} name="Forecast" connectNulls />
            {/* Actual dots */}
            <Line dataKey="actual" stroke={C.actual} strokeWidth={0} dot={{ r: 2, fill: C.actual }} name="Actual (GBB)" connectNulls />
            {/* Forecast / backcast divider */}
            {forecastStart && <ReferenceLine x={fmtDate(forecastStart)} stroke={C.dim} strokeDasharray="4 3" label={{ value: 'Fcast →', fill: C.muted, fontSize: 10, position: 'insideTopRight' }} />}
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: C.muted }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 16, height: 8, background: color, opacity: 0.35, display: 'inline-block', borderRadius: 2 }}></span> PoE 10–90</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 16, height: 2, background: color, display: 'inline-block' }}></span> Forecast</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: C.actual, display: 'inline-block' }}></span> Actual (GBB)</span>
        </div>
      </ChartCard>
    );
  };

  // ── State non-power chart (compact) ──────────────────────────────────────────
  const StateChart = ({ title, predKey, actualKey, color }) => {
    const data = chartData.map(r => ({
      label:    r.label,
      forecast: r[predKey],
      actual:   r[actualKey],
    }));
    return (
      <ChartCard title={title} subtitle="Non-power TJ/day" style={{ flex: '1 1 calc(50% - 8px)', minWidth: 280 }}>
        <ResponsiveContainer width="100%" height={160}>
          <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" {...AXIS} interval={9} />
            <YAxis {...AXIS} width={34} />
            <Tooltip content={<CustomTooltip unit="TJ/day" />} />
            {forecastStart && <ReferenceLine x={fmtDate(forecastStart)} stroke={C.dim} strokeDasharray="4 3" label={{ value: 'Fcast →', fill: C.muted, fontSize: 10, position: 'insideTopRight' }} />}
            <Line dataKey="forecast" stroke={color} strokeWidth={1.5} dot={false} name="Forecast" />
            <Line dataKey="actual" stroke={C.actual} strokeWidth={0} dot={{ r: 2, fill: C.actual }} name="Actual" />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>
    );
  };

  // ── NEM stack chart ───────────────────────────────────────────────────────────
  const NEMStackChart = () => {
    const data = chartData.map(r => ({
      label:    r.label,
      coal:     Math.round(r.coal / 1000),   // → GWh
      wind:     Math.round(r.wind / 1000),
      solar:    Math.round(r.solar / 1000),
      hydro:    Math.round(r.hydro / 1000),
      gas:      Math.round(r.gas_mwh / 1000),
      residual: Math.round(r.residual / 1000),
    }));
    return (
      <ChartCard title="NEM Generation Stack — Daily Forecast" subtitle="GWh/day  ·  stacked area by source">
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" {...AXIS} interval={9} />
            <YAxis {...AXIS} width={38} unit="" />
            <Tooltip content={<NEMTooltip />} />
            {forecastStart && <ReferenceLine x={fmtDate(forecastStart)} stroke={C.dim} strokeDasharray="4 3" label={{ value: 'Fcast →', fill: C.muted, fontSize: 10, position: 'insideTopRight' }} />}
            <Area type="monotone" dataKey="coal"  stackId="nem" fill={C.coal}  stroke="none" name="Coal" />
            <Area type="monotone" dataKey="wind"  stackId="nem" fill={C.wind}  stroke="none" name="Wind" />
            <Area type="monotone" dataKey="solar" stackId="nem" fill={C.solar} stroke="none" name="Solar" />
            <Area type="monotone" dataKey="hydro" stackId="nem" fill={C.hydro} stroke="none" name="Hydro" />
            <Area type="monotone" dataKey="gas"   stackId="nem" fill={C.gas}   stroke="none" name="Gas" />
            <Area type="monotone" dataKey="other" stackId="nem" fill={C.other} stroke="none" name="Other incl BESS and oil" fillOpacity={0.8} />
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11 }}>
          {[['Coal', C.coal], ['Wind', C.wind], ['Solar', C.solar], ['Hydro', C.hydro], ['Gas', C.gas], ['Other incl BESS/oil', C.other]].map(([label, color]) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.muted }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }}></span>
              {label}
            </span>
          ))}
        </div>
      </ChartCard>
    );
  };

  // ── Header KPIs ──────────────────────────────────────────────────────────────
  // KPI strip: show today's forecast if available, else nearest date
  const todayStr = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  })();
  const todayRow = resolvedForecast.find(r => r.date === todayStr)
    ?? resolvedForecast.reduce((best, r) =>
        Math.abs(new Date(r.date) - new Date(todayStr)) < Math.abs(new Date(best.date) - new Date(todayStr)) ? r : best
      , resolvedForecast[resolvedForecast.length - 1]);
  const poeLatest = todayRow ? resolvedPoe[todayRow.date] ?? null : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>

      {/* Header strip */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 15, color: C.text }}>
          2026 Gas Demand Forecast
        </div>
        <div style={{ fontSize: 11, color: C.muted, fontFamily: 'DM Mono, monospace' }}>
          run: {fmtDate(forecastStart ? resolvedForecast.find(r => r.date < forecastStart && r.period === 'backcast')?.date ?? forecastStart : latestDate)} · today: {fmtDate(todayRow?.date)} · horizon: {fmtDate(latestDate)}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {[
            { label: 'Total (P50)',    value: todayRow ? `${todayRow.pred_total.toFixed(0)} TJ` : '—', sub: poeLatest ? `P10 ${poeLatest.p10_total} – P90 ${poeLatest.p90_total}` : null, color: C.blue },
            { label: 'GPG (P50)',      value: todayRow ? `${todayRow.pred_gpg.toFixed(0)} TJ` : '—',   sub: poeLatest ? `P10 ${poeLatest.p10_gpg} – P90 ${poeLatest.p90_gpg}` : null,   color: C.orange },
            { label: 'Non-power (P50)',value: todayRow ? `${todayRow.pred_nonpwr.toFixed(0)} TJ` : '—',sub: poeLatest ? `P10 ${poeLatest.p10_nonpwr} – P90 ${poeLatest.p90_nonpwr}` : null, color: C.green },
          ].map(kpi => (
            <div key={kpi.label} style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6,
              padding: '8px 14px', textAlign: 'right', minWidth: 130,
            }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>{kpi.label}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, fontSize: 16, color: kpi.color }}>{kpi.value}</div>
              {kpi.sub && <div style={{ fontSize: 10, color: C.dim, marginTop: 1 }}>{kpi.sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Upload notice */}
      <div style={{
        background: 'rgba(56,139,253,0.06)', border: `1px solid rgba(56,139,253,0.2)`,
        borderRadius: 6, padding: '8px 14px', fontSize: 12, color: C.muted,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ color: C.blue }}>ℹ</span>
        To update: use <strong style={{ color: C.text }}>↑ Load XLSX/CSV</strong> to upload a new forecast CSV file. Files named <code style={{ fontFamily: 'DM Mono, monospace', color: C.teal }}>gas_forecast_*.csv</code> and <code style={{ fontFamily: 'DM Mono, monospace', color: C.teal }}>gas_forecast_poe_*.csv</code> will be auto-detected.
      </div>

      {/* Row 1 — three main gas demand charts */}
      <GasDemandChart
        title="Total Gas Demand — SE NEM"
        subtitle="GPG + non-power  ·  TJ/day  ·  P10/P90 band shown for forward forecast only"
        predKey="pred_total" actualKey="actual_total"
        poeLoKey="poe_total_lo" poeHiKey="poe_total_hi"
        color={C.blue}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <GasDemandChart
          title="Gas Power Generation Demand"
          subtitle="TJ/day"
          predKey="pred_gpg" actualKey="actual_gpg"
          poeLoKey="poe_gpg_lo" poeHiKey="poe_gpg_hi"
          color={C.orange}
        />
        <GasDemandChart
          title="Non-Power Gas Demand"
          subtitle="Domestic + industrial  ·  TJ/day"
          predKey="pred_nonpwr" actualKey="actual_nonpwr"
          poeLoKey="poe_nonpwr_lo" poeHiKey="poe_nonpwr_hi"
          color={C.green}
        />
      </div>

      {/* Row 2 — four state non-power charts */}
      <div style={{ fontSize: 12, color: C.muted, fontFamily: 'Syne, sans-serif', fontWeight: 600 }}>Non-Power Demand by State</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <StateChart title="Victoria" predKey="pred_vic" actualKey="actual_vic" color={C.blue} />
        <StateChart title="NSW" predKey="pred_nsw" actualKey="actual_nsw" color={C.purple} />
        <StateChart title="South Australia" predKey="pred_sa" actualKey="actual_sa" color={C.teal} />
        <StateChart title="Tasmania" predKey="pred_tas" actualKey="actual_tas" color={C.red} />
      </div>

      {/* Row 3 — NEM generation stack */}
      <NEMStackChart />
    </div>
  );
}
