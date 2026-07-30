Console.WriteLine("pi-timeout test: sitting for 10 seconds...");
Thread.Sleep(TimeSpan.FromSeconds(10));
Console.WriteLine("Done — pi-timeout did NOT kill this.");
