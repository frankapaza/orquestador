import { NextResponse } from 'next/server'

export function middleware(request) {
  const token = request.cookies.get('kubo_token')?.value
  const { pathname } = request.nextUrl

  const isPublic = pathname.startsWith('/login') || pathname.startsWith('/track') || pathname.startsWith('/unsubscribe')

  if (!isPublic && !token) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (pathname === '/' ) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
